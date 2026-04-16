import type { Env } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { pushMessage, textMessage } from '../lib/line';
import { getHabitStages, detectCrisis } from '../lib/stage';

// =============================================
// 朝のプッシュ通知（プロファイリング結果反映）
// =============================================
export async function morningPush(env: Env) {
  const supabase = getSupabase(env);
  const now = new Date();
  const currentHour = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false });

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, nickname, morning_notify_time, coach_tone, coach_style, motivation_type, failure_type, recovery_type')
    .gte('morning_notify_time', `${currentHour}:00`)
    .lt('morning_notify_time', `${currentHour}:59`);

  if (!profiles || profiles.length === 0) return;

  for (const profile of profiles) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('line_user_id, onboarding_completed')
        .eq('id', profile.user_id)
        .single();

      if (!user?.line_user_id || !user.onboarding_completed) continue;

      const message = await buildMorningMessage(supabase, profile);
      if (message) {
        await pushMessage(env, user.line_user_id, message);
        await supabase.from('reminder_logs').insert({
          user_id: profile.user_id,
          reminder_type: 'morning',
        });
      }
    } catch (err) {
      console.error(`Morning push failed for user ${profile.user_id}:`, err);
    }
  }
}

// =============================================
// 夜のプッシュ通知（通数最適化 + 介入ロジック）
// =============================================
export async function eveningPush(env: Env) {
  const supabase = getSupabase(env);
  const now = new Date();
  const currentHour = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false });

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, nickname, evening_notify_time, coach_tone, coach_style, motivation_type, failure_type, recovery_type, reminder_frequency')
    .gte('evening_notify_time', `${currentHour}:00`)
    .lt('evening_notify_time', `${currentHour}:59`);

  if (!profiles || profiles.length === 0) return;

  for (const profile of profiles) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('line_user_id, onboarding_completed')
        .eq('id', profile.user_id)
        .single();

      if (!user?.line_user_id || !user.onboarding_completed) continue;

      // 通数最適化: reminder_frequency = minimal の場合は夜pushを送らない
      // ただし2日連続未達の場合は介入pushとして送る
      const shouldSend = await shouldSendEveningPush(supabase, profile);
      if (!shouldSend.send) continue;

      const message = shouldSend.crisis
        ? await buildCrisisMessage(supabase, profile)
        : await buildEveningMessage(supabase, profile);

      if (message) {
        await pushMessage(env, user.line_user_id, message);
        await supabase.from('reminder_logs').insert({
          user_id: profile.user_id,
          reminder_type: shouldSend.crisis ? 'crisis' : 'evening',
        });
      }
    } catch (err) {
      console.error(`Evening push failed for user ${profile.user_id}:`, err);
    }
  }
}

// =============================================
// 夜push送信判定
// =============================================
async function shouldSendEveningPush(
  supabase: SupabaseClient,
  profile: Record<string, unknown>
): Promise<{ send: boolean; crisis: boolean }> {
  const userId = profile.user_id as string;
  const frequency = (profile.reminder_frequency as string) ?? 'normal';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // 今日の記録状況を確認
  const { data: todayRecords } = await supabase
    .from('habit_records')
    .select('status')
    .eq('user_id', userId)
    .eq('date', today);

  const hasAnyRecord = (todayRecords ?? []).some(
    (r) => r.status === 'achieved' || r.status === 'minimum'
  );

  // 2日連続記録ゼロかチェック
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const { data: yesterdayRecords } = await supabase
    .from('habit_records')
    .select('status')
    .eq('user_id', userId)
    .eq('date', yesterday);

  const yesterdayHasRecord = (yesterdayRecords ?? []).some(
    (r) => r.status === 'achieved' || r.status === 'minimum'
  );

  const twoDaysMissed = !hasAnyRecord && !yesterdayHasRecord;

  // 2日連続未達 → 頻度設定に関わらず介入push
  if (twoDaysMissed) {
    return { send: true, crisis: true };
  }

  // 今日の記録がある → 送信不要（通数節約）
  if (hasAnyRecord) {
    return { send: false, crisis: false };
  }

  // minimal → 通常の夜pushは送らない
  if (frequency === 'minimal') {
    return { send: false, crisis: false };
  }

  return { send: true, crisis: false };
}

// =============================================
// 朝メッセージの構築（プロファイリング反映版）
// =============================================
async function buildMorningMessage(
  supabase: SupabaseClient,
  profile: Record<string, unknown>
) {
  const userId = profile.user_id as string;
  const nickname = (profile.nickname as string) ?? '';
  const tone = (profile.coach_tone as string) ?? 'polite';
  const mType = (profile.motivation_type as string) ?? null;
  const fType = (profile.failure_type as string) ?? null;
  const rType = (profile.recovery_type as string) ?? null;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // アクティブな習慣を取得
  const { data: habits } = await supabase
    .from('habits')
    .select('id, name, achievement_line, minimum_line, anchor_habit, current_streak')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order');

  if (!habits || habits.length === 0) return null;

  // 昨日の記録を取得
  const { data: yesterdayRecords } = await supabase
    .from('habit_records')
    .select('habit_id, status')
    .eq('user_id', userId)
    .eq('date', yesterday);

  const yesterdayMap = new Map((yesterdayRecords ?? []).map((r) => [r.habit_id, r.status]));

  // ステージ情報を取得
  const stages = await getHabitStages(supabase, userId);

  // 直近7日の達成数
  const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const { data: weekRecords } = await supabase
    .from('habit_records')
    .select('habit_id, status')
    .eq('user_id', userId)
    .gte('date', weekAgo)
    .lte('date', yesterday);

  const habitWeekCounts = new Map<string, number>();
  for (const h of habits) {
    const count = (weekRecords ?? []).filter(
      (r) => r.habit_id === h.id && (r.status === 'achieved' || r.status === 'minimum')
    ).length;
    habitWeekCounts.set(h.id, count);
  }

  // メッセージ構築
  const lines: string[] = [];

  // 挨拶（タイプ別）
  lines.push(getMorningGreeting(tone, nickname, mType));
  lines.push('');

  // 習慣ごとの提案
  for (let i = 0; i < habits.length; i++) {
    const h = habits[i];
    const stageInfo = stages.get(h.id);
    const yStatus = yesterdayMap.get(h.id);
    const weekCount = habitWeekCounts.get(h.id) ?? 0;

    let line = `${i + 1}. ${h.name}`;

    // アンカー習慣表示
    if (h.anchor_habit) {
      line += ` (${h.anchor_habit} ->)`;
    }

    // ストリーク表示
    if (h.current_streak >= 3) {
      line += ` [${h.current_streak}d]`;
    }

    // 提案メッセージ（ステージ × プロファイリング考慮）
    const suggestion = buildHabitSuggestion(
      tone, mType, fType, stageInfo?.stage ?? 'preparation',
      yStatus, weekCount, h.minimum_line
    );
    if (suggestion) {
      line += `\n   ${suggestion}`;
    }

    lines.push(line);
  }

  lines.push('');
  lines.push(getMorningClosing(tone, mType));

  return [textMessage(lines.join('\n'))];
}

// =============================================
// 夜メッセージの構築（プロファイリング反映版）
// =============================================
async function buildEveningMessage(
  supabase: SupabaseClient,
  profile: Record<string, unknown>
) {
  const userId = profile.user_id as string;
  const nickname = (profile.nickname as string) ?? '';
  const tone = (profile.coach_tone as string) ?? 'polite';
  const mType = (profile.motivation_type as string) ?? null;
  const fType = (profile.failure_type as string) ?? null;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { data: habits } = await supabase
    .from('habits')
    .select('id, name, minimum_line')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order');

  if (!habits || habits.length === 0) return null;

  const { data: todayRecords } = await supabase
    .from('habit_records')
    .select('habit_id, status')
    .eq('user_id', userId)
    .eq('date', today);

  const recordMap = new Map((todayRecords ?? []).map((r) => [r.habit_id, r.status]));

  const achieved: string[] = [];
  const minimum: string[] = [];
  const missed: Array<{ name: string; minimumLine: string | null; index: number }> = [];

  habits.forEach((h, i) => {
    const status = recordMap.get(h.id);
    if (status === 'achieved') achieved.push(h.name);
    else if (status === 'minimum') minimum.push(h.name);
    else missed.push({ name: h.name, minimumLine: h.minimum_line, index: i + 1 });
  });

  // 全達成
  if (missed.length === 0 && minimum.length === 0 && achieved.length > 0) {
    return [textMessage(getAllDoneMessage(tone, nickname, achieved.length, mType))];
  }

  // 全達成（最低ライン含む）
  if (missed.length === 0) {
    return [textMessage(getMinimumDoneMessage(tone, nickname, achieved.length, minimum.length, fType))];
  }

  // 未完了あり
  const lines: string[] = [];
  lines.push(getEveningGreeting(tone, nickname, mType));
  lines.push('');

  for (const h of habits) {
    const status = recordMap.get(h.id);
    if (status === 'achieved') lines.push(`[x] ${h.name}`);
    else if (status === 'minimum') lines.push(`[/] ${h.name}`);
    else lines.push(`[ ] ${h.name}`);
  }

  lines.push('');

  if (missed.length === 1) {
    const m = missed[0];
    const minAction = m.minimumLine ? `「${m.minimumLine}」` : '最低ラインだけ';
    lines.push(getSingleMissedPrompt(tone, m.name, minAction, fType));
  } else {
    lines.push(getMultipleMissedPrompt(tone, missed.length, fType));
    for (const m of missed) {
      const minAction = m.minimumLine ? ` -> ${m.minimumLine}` : '';
      lines.push(`  ${m.index}m で最低ライン記録${minAction}`);
    }
  }

  lines.push('');
  lines.push('番号を送って記録できます。');

  return [textMessage(lines.join('\n'))];
}

// =============================================
// 危機介入メッセージ（2日連続未達時）
// =============================================
async function buildCrisisMessage(
  supabase: SupabaseClient,
  profile: Record<string, unknown>
) {
  const userId = profile.user_id as string;
  const nickname = (profile.nickname as string) ?? '';
  const tone = (profile.coach_tone as string) ?? 'polite';
  const style = (profile.coach_style as string) ?? 'balanced';
  const mType = (profile.motivation_type as string) ?? null;
  const fType = (profile.failure_type as string) ?? null;
  const rType = (profile.recovery_type as string) ?? null;

  const { data: habits } = await supabase
    .from('habits')
    .select('id, name, minimum_line')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order')
    .limit(1);

  if (!habits || habits.length === 0) return null;

  const h = habits[0];
  const minAction = h.minimum_line ? `「${h.minimum_line}」` : '最低ラインだけ';

  const message = buildCrisisText(tone, style, nickname, h.name, minAction, mType, fType, rType);
  return [textMessage(message)];
}

// =============================================
// タイプ別メッセージテンプレート
// =============================================

function getMorningGreeting(tone: string, name: string, mType: string | null): string {
  const n = name ? `${name}さん` : '';

  // M3（他者駆動）: 報告文脈を作る
  if (mType === 'M3') {
    switch (tone) {
      case 'frank': return `おはよう${name ? '、' + name : ''}。今日の予定、教えて。`;
      case 'aniki': return `おはよう${name ? '、' + name : ''}。今日の予定を報告しろ。`;
      case 'neutral': return `おはようございます。本日の予定を確認します。`;
      default: return `おはようございます${n ? '、' + n : ''}。今日の予定を教えてください。`;
    }
  }

  // M4（自由駆動）: 選択の自由を尊重
  if (mType === 'M4') {
    switch (tone) {
      case 'frank': return `おはよう${name ? '、' + name : ''}。今日はどうする？`;
      case 'aniki': return `おはよう。今日、何をやるかはお前が決めろ。`;
      case 'neutral': return `おはようございます。本日の選択です。`;
      default: return `おはようございます${n ? '、' + n : ''}。今日はどうしますか？`;
    }
  }

  // M2（納得駆動）: データ寄り
  if (mType === 'M2') {
    switch (tone) {
      case 'frank': return `おはよう${name ? '、' + name : ''}。今週のデータと一緒に。`;
      case 'aniki': return `おはよう。数字を確認しろ。`;
      case 'neutral': return `おはようございます。本日の状況です。`;
      default: return `おはようございます${n ? '、' + n : ''}。今日の提案です。`;
    }
  }

  // M1（自律駆動）/ デフォルト
  switch (tone) {
    case 'frank': return `おはよう${name ? '、' + name : ''}!`;
    case 'aniki': return `おはよう${name ? '、' + name : ''}。`;
    case 'neutral': return `おはようございます。`;
    default: return `おはようございます${n ? '、' + n : ''}。`;
  }
}

function buildHabitSuggestion(
  tone: string,
  mType: string | null,
  fType: string | null,
  stage: string,
  yesterdayStatus: string | undefined,
  weekCount: number,
  minimumLine: string | null
): string {
  // 準備期: 「まず1回やること」だけに集中
  if (stage === 'preparation') {
    return getPrepSuggestion(tone);
  }

  // 昨日未達
  if (!yesterdayStatus || yesterdayStatus === 'missed') {
    const minLine = minimumLine ? `「${minimumLine}」だけ` : '最低ラインだけ';

    // F4（基準過剰）: 「最低ラインでOK」を強調
    if (fType === 'F4') {
      return getPerfectionistMissedSuggestion(tone, minLine);
    }

    return getMissedSuggestion(tone, minLine);
  }

  // 週5以上達成
  if (weekCount >= 5) {
    // M2（納得駆動）: 数字で示す
    if (mType === 'M2') {
      return `-> 週間達成率: ${Math.round(weekCount / 7 * 100)}%。この習慣の効果が蓄積しています`;
    }
    return getStreakMessage(tone, weekCount);
  }

  // F1（動機減衰）で3週以上: 飽き対策
  if (fType === 'F1' && stage === 'execution_mid') {
    return getBoredSuggestion(tone);
  }

  // 通常
  return getContinueMessage(tone);
}

function getPrepSuggestion(tone: string): string {
  switch (tone) {
    case 'frank': return '-> まず今日1回やってみよう';
    case 'aniki': return '-> 今日1回やれ。それだけでいい';
    case 'neutral': return '-> 初回実行を推奨';
    default: return '-> まず今日1回、やってみましょう';
  }
}

function getMissedSuggestion(tone: string, minLine: string): string {
  switch (tone) {
    case 'frank': return `-> 昨日できなかったね。${minLine}でいいよ`;
    case 'aniki': return `-> 昨日未達。今日は${minLine}やれ`;
    case 'neutral': return `-> 前日未達。${minLine}を推奨`;
    default: return `-> 昨日は未達でした。${minLine}狙いましょう`;
  }
}

function getPerfectionistMissedSuggestion(tone: string, minLine: string): string {
  switch (tone) {
    case 'frank': return `-> ${minLine}でOK。完璧じゃなくていい`;
    case 'aniki': return `-> ${minLine}やれ。やったかやらないかだ`;
    case 'neutral': return `-> ${minLine}で十分有効。実行を推奨`;
    default: return `-> ${minLine}で十分です。完璧でなくて大丈夫`;
  }
}

function getStreakMessage(tone: string, count: number): string {
  switch (tone) {
    case 'frank': return `-> 今週${count}/7！いい感じ`;
    case 'aniki': return `-> ${count}/7。悪くない`;
    case 'neutral': return `-> 週間達成率: ${Math.round(count / 7 * 100)}%`;
    default: return `-> 今週${count}/7達成。この調子です`;
  }
}

function getBoredSuggestion(tone: string): string {
  switch (tone) {
    case 'frank': return '-> 少しマンネリかも？やり方を変えてみない？';
    case 'aniki': return '-> 飽きが来てるだろ。やり方を変えろ';
    case 'neutral': return '-> 変化の導入を推奨。実行方法の変更を検討';
    default: return '-> やり方を少し変えてみませんか？場所や時間を変えるだけでも';
  }
}

function getContinueMessage(tone: string): string {
  switch (tone) {
    case 'frank': return '-> 今日もやっていこう';
    case 'aniki': return '-> 今日も取りに行け';
    case 'neutral': return '-> 継続推奨';
    default: return '-> 今日も取り組みましょう';
  }
}

function getMorningClosing(tone: string, mType: string | null): string {
  // M3: 報告を求める
  if (mType === 'M3') {
    switch (tone) {
      case 'frank': return '今日の結果、あとで教えてね。';
      case 'aniki': return '結果は必ず報告しろ。';
      case 'neutral': return '本日の結果報告をお待ちしています。';
      default: return '今日の結果を教えてください。待っています。';
    }
  }

  // M4: 選択を委ねる
  if (mType === 'M4') {
    switch (tone) {
      case 'frank': return 'やるかどうかはあなた次第。';
      case 'aniki': return 'あとはお前が決めろ。';
      case 'neutral': return '実行の判断はお任せします。';
      default: return 'やるかどうかは、あなたが決めることです。';
    }
  }

  // デフォルト
  switch (tone) {
    case 'frank': return '今日のフォーカスは何にする？';
    case 'aniki': return '今日の一発目を決めろ。';
    case 'neutral': return '本日のフォーカスを入力してください。';
    default: return '今日のフォーカスを1つ教えてください。';
  }
}

function getEveningGreeting(tone: string, name: string, mType: string | null): string {
  // M3: 報告の受理
  if (mType === 'M3') {
    switch (tone) {
      case 'frank': return `${name ? name + '、' : ''}今日の結果を確認するよ。`;
      case 'aniki': return `${name ? name + '、' : ''}報告の時間だ。`;
      case 'neutral': return '本日の記録状況です。';
      default: return `${name ? name + 'さん、' : ''}今日の記録を確認しました。`;
    }
  }

  switch (tone) {
    case 'frank': return `${name ? name + '、' : ''}今日の結果だよ。`;
    case 'aniki': return `${name ? name + '、' : ''}今日の報告だ。`;
    case 'neutral': return '本日の記録状況です。';
    default: return `${name ? name + 'さん、' : ''}今日の記録です。`;
  }
}

function getAllDoneMessage(tone: string, name: string, count: number, mType: string | null): string {
  let base: string;
  switch (tone) {
    case 'frank': base = `${name ? name + '、' : ''}今日${count}個全部達成！お疲れ！`; break;
    case 'aniki': base = `${count}個全達成。よくやった。明日も取れ。`; break;
    case 'neutral': base = `本日の達成: ${count}/${count} (100%)。`; break;
    default: base = `${name ? name + 'さん、' : ''}今日は${count}個すべて達成です。お疲れさまでした。`; break;
  }

  if (mType === 'M3') base += '\n報告、確かに受け取りました。';
  return base;
}

function getMinimumDoneMessage(tone: string, name: string, achieved: number, minimum: number, fType: string | null): string {
  const total = achieved + minimum;
  let base: string;
  switch (tone) {
    case 'frank': base = `${total}個クリア！（うち${minimum}個は最低ライン）やったじゃん。`; break;
    case 'aniki': base = `全項目クリア。最低ライン${minimum}個。やり切ったな。`; break;
    case 'neutral': base = `達成: ${achieved}件 / 最低ライン: ${minimum}件 / 未達: 0件。`; break;
    default: base = `${name ? name + 'さん、' : ''}全項目クリアです。${minimum}個は最低ラインでしたが、それも立派な達成です。`; break;
  }

  // F4（基準過剰）: 追加の肯定
  if (fType === 'F4') {
    base += '\n最低ラインでやり切ったことが、何より価値があります。';
  }

  return base;
}

function getSingleMissedPrompt(tone: string, habitName: string, minAction: string, fType: string | null): string {
  // F4: 基準を下げる表現
  if (fType === 'F4') {
    switch (tone) {
      case 'frank': return `${habitName}がまだだね。${minAction}だけでOK。完璧じゃなくていいよ。`;
      case 'aniki': return `${habitName}が残ってる。${minAction}やれ。やったかやらないかだ。`;
      case 'neutral': return `未達: ${habitName}。${minAction}で十分有効です。`;
      default: return `${habitName}がまだです。${minAction}で十分です。完璧でなくて大丈夫。`;
    }
  }

  switch (tone) {
    case 'frank': return `${habitName}がまだだね。${minAction}だけでもやってみない？`;
    case 'aniki': return `${habitName}が残ってる。${minAction}やれ。今日中にだ。`;
    case 'neutral': return `未達: ${habitName}。${minAction}の実行を推奨します。`;
    default: return `${habitName}がまだです。${minAction}でも今日中にやってみませんか？`;
  }
}

function getMultipleMissedPrompt(tone: string, count: number, fType: string | null): string {
  if (fType === 'F4') {
    switch (tone) {
      case 'frank': return `${count}個まだだよ。全部じゃなくていい、1個だけでも:`;
      case 'aniki': return `${count}個残ってる。1個だけでいい。やれ:`;
      case 'neutral': return `未達: ${count}件。1件でも記録を推奨:`;
      default: return `${count}個がまだですが、1個だけでも記録しませんか:`;
    }
  }

  switch (tone) {
    case 'frank': return `${count}個まだだよ。最低ラインだけでもやろう:`;
    case 'aniki': return `${count}個残ってる。最低ラインだけでいい、やれ:`;
    case 'neutral': return `未達: ${count}件。最低ラインでの記録を推奨:`;
    default: return `${count}個がまだです。最低ラインだけでも記録しませんか:`;
  }
}

// =============================================
// 危機介入テンプレート（2日連続未達）
// =============================================
function buildCrisisText(
  tone: string,
  style: string,
  name: string,
  habitName: string,
  minAction: string,
  mType: string | null,
  fType: string | null,
  rType: string | null
): string {
  const lines: string[] = [];

  // 冒頭
  const n = name || '';
  switch (tone) {
    case 'frank': lines.push(`${n ? n + '、' : ''}2日空いちゃったね。`); break;
    case 'aniki': lines.push(`${n ? n + '、' : ''}2日連続だ。`); break;
    case 'neutral': lines.push('2日連続未達を検知しました。'); break;
    default: lines.push(`${n ? n + 'さん、' : ''}2日間、記録がありません。`); break;
  }

  // スタイル別の強度
  if (style === 'strict') {
    switch (tone) {
      case 'frank': lines.push('3日目に入ったら、ここまでの積み上げが消えるよ。'); break;
      case 'aniki': lines.push('3日目はない。今日やれ。'); break;
      case 'neutral': lines.push('統計上、3日連続で習慣継続率は大幅に低下します。'); break;
      default: lines.push('3日目に入ると、積み上げたものが崩れてしまいます。'); break;
    }
  } else if (style === 'gentle') {
    switch (tone) {
      case 'frank': lines.push('大丈夫、まだ取り戻せるよ。'); break;
      case 'aniki': lines.push('誰でも止まる時はある。'); break;
      case 'neutral': lines.push('再開は常に可能です。'); break;
      default: lines.push('大丈夫です。ここから立て直しましょう。'); break;
    }
  }

  // 回復型別の提案
  lines.push('');
  if (rType === 'R1') {
    // 宣言リセット型
    lines.push(`今日、「${habitName}をやる」と決め直してください。`);
  } else if (rType === 'R2') {
    // 分析改善型
    lines.push('この2日間、何が障害でしたか？');
    lines.push('原因がわかれば、仕組みを修正できます。');
  } else if (rType === 'R3') {
    // 外部再接続型
    lines.push('あなたの記録を待っています。');
    lines.push(`${minAction}だけでも、報告してください。`);
  } else {
    // R4 最小行動型（デフォルト）
    lines.push(`${minAction}。それだけでいい。`);
    lines.push('考えすぎず、1つだけ。');
  }

  // M3特有: 報告文脈の強化
  if (mType === 'M3') {
    lines.push('');
    lines.push('あなたの報告を、ここで待っています。');
  }

  return lines.join('\n');
}
