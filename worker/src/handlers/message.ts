import { SupabaseClient } from '@supabase/supabase-js';
import type { Env, User, UserProfile, LineEvent, Habit } from '../types';
import { replyMessage, textMessage, flexMessage, showLoadingAnimation } from '../lib/line';
import {
  upsertProfile,
  getActiveHabits,
  addHabit,
  deactivateHabit,
  recordHabits,
  getTodayRecords,
  upsertDailyLog,
  getRecentRecords,
  getRecentMessages,
  saveChatMessage,
  getUserNotes,
  saveUserNotes,
} from '../lib/supabase';
import { evaluateStage, getHabitStages } from '../lib/stage';
import { buildHabitListFlex } from '../lib/flex';
import { getCoachResponse, extractUserInfo } from '../lib/coach';
import { calcRecordXp, calcLogXp, grantXp, xpToNextLevel } from '../lib/xp';
import { onboardingQ1 } from './onboarding-steps';

export async function handleTextMessage(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile | null,
  event: LineEvent
) {
  const text = event.message!.text!.trim();

  // オンボーディング中の処理
  if (!user.onboarding_completed && profile) {
    await handleOnboardingInput(env, supabase, user, profile, event, text);
    return;
  }

  // コマンドパース
  const lower = text.toLowerCase();

  if (lower.startsWith('追加 ') || lower.startsWith('add ')) {
    const name = text.replace(/^(追加|add)\s+/i, '').trim();
    await handleAddHabit(env, supabase, user, event, name);
    return;
  }

  if (lower.startsWith('削除 ') || lower.startsWith('delete ')) {
    const name = text.replace(/^(削除|delete)\s+/i, '').trim();
    await handleDeleteHabit(env, supabase, user, event, name);
    return;
  }

  // アンカー習慣設定（例: 「トリガー 朝散歩 コーヒーの後」）
  const anchorMatch = text.match(/^(トリガー|anchor)\s+(.+?)\s+(.+)$/i);
  if (anchorMatch) {
    await handleSetAnchor(env, supabase, user, event, anchorMatch[2], anchorMatch[3]);
    return;
  }

  // 達成ライン/最低ライン設定（例: 「設定 朝散歩 達成:30分 最低:5分」）
  const lineMatch = text.match(/^設定\s+(.+?)\s+(達成[:：](.+?))?(\s+最低[:：](.+))?$/);
  if (lineMatch) {
    await handleSetLines(env, supabase, user, event, lineMatch[1], lineMatch[3], lineMatch[5]);
    return;
  }

  if (lower === '一覧' || lower === 'list') {
    await handleListHabits(env, supabase, user, profile, event);
    return;
  }

  if (lower === 'リセット' || lower === 'reset') {
    await handleReset(env, supabase, user, event);
    return;
  }

  if (lower === 'プロファイルリセット') {
    await handleProfileReset(env, supabase, user, event);
    return;
  }

  if (lower === '設定' || lower === 'settings') {
    await handleSettings(env, event);
    return;
  }

  if (lower === 'ヘルプ' || lower === 'help') {
    await handleHelp(env, event);
    return;
  }

  if (lower.startsWith('ログ ') || lower.startsWith('log ')) {
    const content = text.replace(/^(ログ|log)\s+/i, '').trim();
    await handleOneLineLog(env, supabase, user, event, content);
    return;
  }

  // 数字ベースの記録入力（例: "1,2,3m" → 1,2は達成、3は最低ライン）
  if (/^[\d,mM\s]+$/.test(text)) {
    await handleQuickRecord(env, supabase, user, profile, event, text);
    return;
  }

  // フリーテキスト → フォーカスまたはハイライトとして保存
  await handleFreeText(env, supabase, user, profile, event, text);
}

// === オンボーディング入力 ===

async function handleOnboardingInput(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile,
  event: LineEvent,
  text: string
) {
  const step = profile.onboarding_step;

  if (step === 1) {
    // ニックネーム入力 → Q1へ
    await upsertProfile(supabase, user.id, {
      nickname: text,
      onboarding_step: 2,
    });
    await replyMessage(env, event.replyToken, [
      textMessage(`${text}さん、よろしくお願いします。\nでは、あなたの習慣化タイプを診断します。`),
      flexMessage('動機の源泉 (1/2)', onboardingQ1()),
    ]);
    return;
  }

  // Step 2以降はpostbackで処理するので、テキスト入力が来た場合の案内
  await replyMessage(env, event.replyToken, [
    textMessage('ボタンを選択してください。'),
  ]);
}

// === 習慣管理 ===

async function handleAddHabit(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent,
  name: string
) {
  if (!name) {
    await replyMessage(env, event.replyToken, [
      textMessage('習慣名を指定してください。\n例: 追加 朝散歩'),
    ]);
    return;
  }

  const habit = await addHabit(supabase, user.id, name);
  const habits = await getActiveHabits(supabase, user.id);

  await replyMessage(env, event.replyToken, [
    textMessage(
      [
        `「${habit.name}」を追加しました。(${habits.length}個目)`,
        '',
        '次のステップ:',
        `1. 達成ライン/最低ラインの設定`,
        `   「設定 ${habit.name} 達成:30分散歩 最低:外に出る」`,
        '',
        `2. トリガー（何のあとにやる？）の設定`,
        `   「トリガー ${habit.name} コーヒーの後」`,
        '',
        'どちらも後から設定できます。',
      ].join('\n')
    ),
  ]);
}

async function handleSetAnchor(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent,
  habitName: string,
  anchor: string
) {
  const { data, error } = await supabase
    .from('habits')
    .update({ anchor_habit: anchor.trim() })
    .eq('user_id', user.id)
    .eq('name', habitName.trim())
    .eq('is_active', true)
    .select();

  if (error || !data || data.length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage(`「${habitName}」が見つかりません。\n「一覧」で確認してください。`),
    ]);
    return;
  }

  await replyMessage(env, event.replyToken, [
    textMessage(`「${habitName}」のトリガーを設定しました。\n\n${anchor} → ${habitName}\n\n朝のメッセージでお知らせします。`),
  ]);
}

async function handleSetLines(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent,
  habitName: string,
  achievementLine: string | undefined,
  minimumLine: string | undefined
) {
  const updates: Record<string, string> = {};
  if (achievementLine) updates.achievement_line = achievementLine.trim();
  if (minimumLine) updates.minimum_line = minimumLine.trim();

  if (Object.keys(updates).length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage(`例: 設定 ${habitName} 達成:30分散歩 最低:外に出る`),
    ]);
    return;
  }

  const { data } = await supabase
    .from('habits')
    .update(updates)
    .eq('user_id', user.id)
    .eq('name', habitName.trim())
    .eq('is_active', true)
    .select();

  if (!data || data.length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage(`「${habitName}」が見つかりません。`),
    ]);
    return;
  }

  const lines: string[] = [`「${habitName}」のラインを更新しました。`];
  if (achievementLine) lines.push(`達成ライン: ${achievementLine.trim()}`);
  if (minimumLine) lines.push(`最低ライン: ${minimumLine.trim()}`);

  await replyMessage(env, event.replyToken, [textMessage(lines.join('\n'))]);
}

async function handleDeleteHabit(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent,
  name: string
) {
  const deleted = await deactivateHabit(supabase, user.id, name);

  if (deleted) {
    await replyMessage(env, event.replyToken, [
      textMessage(`「${name}」を削除しました。`),
    ]);
  } else {
    await replyMessage(env, event.replyToken, [
      textMessage(`「${name}」が見つかりません。\n「一覧」で現在の習慣を確認できます。`),
    ]);
  }
}

async function handleListHabits(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile | null,
  event: LineEvent
) {
  const habits = await getActiveHabits(supabase, user.id);

  if (habits.length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage('まだ習慣が登録されていません。\n「追加 朝散歩」のように送ってください。'),
    ]);
    return;
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const [todayRecs, weekRecs] = await Promise.all([
    getTodayRecords(supabase, user.id, today),
    getRecentRecords(supabase, user.id, 7),
  ]);

  await replyMessage(env, event.replyToken, [
    flexMessage('習慣一覧', buildHabitListFlex(habits, todayRecs, weekRecs, today, profile)),
  ]);
}

// === クイック記録（改善版）===

async function handleQuickRecord(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile | null,
  event: LineEvent,
  text: string
) {
  const habits = await getActiveHabits(supabase, user.id);
  if (habits.length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage('習慣が登録されていません。\n「追加 朝散歩」で追加してください。'),
    ]);
    return;
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const parts = text.split(/[,\s]+/).filter(Boolean);

  const records: Array<{ habitId: string; status: 'achieved' | 'minimum' }> = [];

  for (const part of parts) {
    const isMinimum = part.toLowerCase().endsWith('m');
    const num = parseInt(isMinimum ? part.slice(0, -1) : part, 10);

    if (isNaN(num) || num < 1 || num > habits.length) continue;

    const habit = habits[num - 1];
    records.push({
      habitId: habit.id,
      status: isMinimum ? 'minimum' : 'achieved',
    });
  }

  if (records.length === 0) {
    await replyMessage(env, event.replyToken, [
      textMessage('有効な番号がありません。\n「一覧」で番号を確認してください。'),
    ]);
    return;
  }

  await recordHabits(supabase, user.id, today, records);

  // ステージ評価（各習慣に対して）
  const stageResults: Array<{ name: string; stage: string; changed: boolean; crisis: boolean }> = [];
  for (const r of records) {
    const result = await evaluateStage(supabase, user.id, r.habitId);
    const h = habits.find((h) => h.id === r.habitId);
    stageResults.push({ name: h?.name ?? '', ...result });
  }

  // 更新後のストリークを再取得
  const updatedHabits = await getActiveHabits(supabase, user.id);
  const updatedMap = new Map(updatedHabits.map((h) => [h.id, h]));

  // フィードバックメッセージ構築
  const tone = profile?.coach_tone ?? 'polite';
  const style = profile?.coach_style ?? 'balanced';
  const mType = profile?.motivation_type ?? null;
  const fType = profile?.failure_type ?? null;

  const lines: string[] = [];

  for (const r of records) {
    const h = updatedMap.get(r.habitId);
    if (!h) continue;

    const mark = r.status === 'achieved' ? '[x]' : '[/]';
    const stageInfo = stageResults.find((s) => s.name === h.name);
    const streak = h.current_streak;

    let feedback = '';

    // ストリーク表示
    if (streak >= 7) {
      feedback = getStreakFeedback(tone, streak);
    } else if (streak >= 3) {
      feedback = getSmallStreakFeedback(tone, streak);
    }

    // 最低ライン達成時の肯定（F4対策）
    if (r.status === 'minimum' && fType === 'F4') {
      feedback = getPerfectionismFeedback(tone);
    }

    // ステージ遷移フィードバック
    if (stageInfo?.changed) {
      feedback += ` ${getStageTransitionMessage(tone, stageInfo.stage)}`;
    }

    lines.push(`${mark} ${h.name}${streak > 0 ? ` (${streak}d)` : ''}${feedback ? ` ${feedback}` : ''}`);
  }

  // 全体フィードバック
  const allHabitsCount = habits.length;
  const todayRecords = await getTodayRecords(supabase, user.id, today);
  const doneCount = todayRecords.filter((r) => r.status === 'achieved' || r.status === 'minimum').length;
  const allComplete = doneCount === allHabitsCount;

  let overallMsg = '';
  if (allComplete) {
    overallMsg = getAllDoneFeedback(tone, mType);
  } else {
    overallMsg = getPartialFeedback(tone, doneCount, allHabitsCount);
  }

  // XP付与
  const streaksForXp = records.map(r => {
    const h = updatedMap.get(r.habitId);
    return { streak: h?.current_streak ?? 0 };
  });
  const xpGained = calcRecordXp(records, streaksForXp, allComplete);
  const xpResult = await grantXp(supabase, user.id, xpGained);

  let xpLine = `+${xpResult.xpGained} XP`;
  if (xpResult.leveledUp) {
    xpLine += ` >> Lv.${xpResult.level} UP!`;
  } else {
    const progress = xpToNextLevel(xpResult.totalXp);
    xpLine += ` (Lv.${xpResult.level} ${progress.current}/${progress.needed})`;
  }

  // 更新後のプロフィール取得
  const { data: updatedProfile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  const weekRecs = await getRecentRecords(supabase, user.id, 7);

  await replyMessage(env, event.replyToken, [
    textMessage(`${lines.join('\n')}\n\n${overallMsg}\n${xpLine}`),
    flexMessage('習慣一覧', buildHabitListFlex(updatedHabits, todayRecords, weekRecs, today, updatedProfile)),
  ]);
}

// === リセット ===

async function handleReset(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent
) {
  await supabase.from('user_profiles').delete().eq('user_id', user.id);
  await supabase.from('habits').update({ is_active: false }).eq('user_id', user.id);
  await supabase.from('users').update({ onboarding_completed: false }).eq('id', user.id);

  await upsertProfile(supabase, user.id, {
    onboarding_step: 1,
    coach_style: 'balanced',
    coach_tone: 'polite',
    reminder_frequency: 'normal',
    morning_notify_time: '08:00',
    evening_notify_time: '22:00',
    failure_patterns: [],
  });

  await replyMessage(env, event.replyToken, [
    textMessage('プロファイルをリセットしました。\n最初から設定し直しましょう。\n\nニックネームを教えてください。'),
  ]);
}

// === プロファイルリセット ===

async function handleProfileReset(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent
) {
  await supabase.from('user_profiles').delete().eq('user_id', user.id);
  await supabase.from('users').update({ onboarding_completed: false }).eq('id', user.id);
  await upsertProfile(supabase, user.id, {
    onboarding_step: 1,
    coach_style: 'balanced',
    coach_tone: 'polite',
    reminder_frequency: 'normal',
    failure_patterns: [],
  });
  await replyMessage(env, event.replyToken, [
    textMessage('プロファイルをリセットしました。\n習慣データはそのまま残っています。\n\nニックネームを教えてください。'),
  ]);
}

// === 設定メニュー ===

async function handleSettings(env: Env, event: LineEvent) {
  await replyMessage(env, event.replyToken, [
    flexMessage('設定メニュー', {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '設定', size: 'md', weight: 'bold', color: '#FF8A65' },
        ],
        paddingAll: 'lg',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          settingsButton('関わり方を変更', 'action=menu_change_style'),
          settingsButton('話し方を変更', 'action=menu_change_tone'),
          settingsButton('タイプ診断をやり直す', 'action=menu_reprofile'),
          settingsButton('プロファイル全リセット', 'action=menu_reset_profile'),
        ],
        paddingAll: 'lg',
      },
    }),
  ]);
}

function settingsButton(label: string, data: string): Record<string, unknown> {
  return {
    type: 'button',
    action: { type: 'postback', label, data, displayText: label },
    style: 'secondary',
    height: 'sm',
  };
}

// === ひとことログ ===

async function handleOneLineLog(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent,
  content: string
) {
  if (!content) {
    await replyMessage(env, event.replyToken, [
      textMessage('ひとことを書いてください。\n例: ログ 朝ちゃんと起きれた'),
    ]);
    return;
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // daily_logsのhighlightに保存（既存があれば追記）
  const { data: existing } = await supabase
    .from('daily_logs')
    .select('highlight')
    .eq('user_id', user.id)
    .eq('date', today)
    .single();

  const prev = existing?.highlight ?? '';
  const newHighlight = prev ? `${prev}\n${content}` : content;

  await upsertDailyLog(supabase, user.id, today, { highlight: newHighlight });

  // XP付与（1日1回のみボーナス）
  const isFirstLog = !prev;
  if (isFirstLog) {
    const xpGained = calcLogXp();
    const xpResult = await grantXp(supabase, user.id, xpGained);

    let xpLine = `+${xpResult.xpGained} XP`;
    if (xpResult.leveledUp) {
      xpLine += ` >> Lv.${xpResult.level} UP!`;
    }

    await replyMessage(env, event.replyToken, [
      textMessage(`${content}\n\n${xpLine}`),
    ]);
  } else {
    await replyMessage(env, event.replyToken, [
      textMessage(`${content}`),
    ]);
  }
}

// === ヘルプ ===

async function handleHelp(env: Env, event: LineEvent) {
  await replyMessage(env, event.replyToken, [
    textMessage(
      [
        '--- リズ コマンド一覧 ---',
        '',
        '追加 〇〇 ... 習慣を追加',
        '削除 〇〇 ... 習慣を削除',
        '一覧 ... 今日の習慣と達成状況',
        '1,2,3m ... クイック記録',
        '  (番号=達成, 番号m=最低ライン)',
        'トリガー 〇〇 △△ ... トリガー設定',
        '  (「△△の後に〇〇をやる」)',
        '設定 〇〇 達成:X 最低:Y',
        '  ... 達成/最低ラインの設定',
        '設定 ... 関わり方・話し方の変更',
        'ログ 〇〇 ... ひとこと日記 (+XP)',
        'リセット ... 全データを初期化',
        'プロファイルリセット ... プロファイルのみ',
        'ヘルプ ... この案内を表示',
      ].join('\n')
    ),
  ]);
}

// === フリーテキスト ===

async function handleFreeText(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile | null,
  event: LineEvent,
  text: string
) {
  // ローディングインジケーター表示（AI応答生成中）
  await showLoadingAnimation(env, event.source.userId);

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // 会話履歴・習慣・記録・ユーザーメモを並行取得
  const [chatHistory, habits, todayRecs, logs, userNotes] = await Promise.all([
    getRecentMessages(supabase, user.id, 10),
    getActiveHabits(supabase, user.id),
    getTodayRecords(supabase, user.id, today),
    supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single(),
    getUserNotes(supabase, user.id),
  ]);

  const responses = await getCoachResponse(env, {
    nickname: profile?.nickname ?? 'ユーザー',
    profile,
    habits,
    todayRecords: todayRecs,
    recentLog: logs.data ?? null,
    chatHistory,
    userNotes,
  }, text);

  // 返答を最優先で送信（速度改善）
  await replyMessage(env, event.replyToken, responses.map(r => textMessage(r)));

  // DB保存は返答後に非同期実行（ユーザー体感を妨げない）
  const assistantText = responses.join('\n\n');
  saveChatMessage(supabase, user.id, 'user', text)
    .then(() => saveChatMessage(supabase, user.id, 'assistant', assistantText))
    .catch(() => {});

  // 会話から新しいユーザー情報を抽出して保存（非同期）
  const allHistory = [...chatHistory, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: assistantText }];
  extractUserInfo(env, allHistory as any, userNotes).then(notes => {
    if (notes.length > 0) saveUserNotes(supabase, user.id, notes);
  }).catch(() => {});
}

// =============================================
// フィードバックテンプレート
// =============================================

function getStreakFeedback(tone: string, streak: number): string {
  switch (tone) {
    case 'frank': return `— ${streak}日連続！すごいじゃん`;
    case 'aniki': return `— ${streak}日連続。さすがだ`;
    case 'neutral': return `— 連続${streak}日達成`;
    default: return `— ${streak}日連続達成です`;
  }
}

function getSmallStreakFeedback(tone: string, streak: number): string {
  switch (tone) {
    case 'frank': return `— ${streak}日目！`;
    case 'aniki': return `— ${streak}日目。続けろ`;
    case 'neutral': return `— ${streak}日目`;
    default: return `— ${streak}日目です`;
  }
}

function getPerfectionismFeedback(tone: string): string {
  switch (tone) {
    case 'frank': return '— 最低ラインでも十分！やったことが大事';
    case 'aniki': return '— 最低ラインでもやった。それでいい';
    case 'neutral': return '— 最低ライン達成。有効な記録です';
    default: return '— 最低ラインでも立派な達成です';
  }
}

function getStageTransitionMessage(tone: string, stage: string): string {
  const stageNames: Record<string, string> = {
    preparation: '準備期',
    execution_early: '実行期（序盤）',
    execution_mid: '実行期（中盤）',
    established: '定着期',
  };
  const name = stageNames[stage] ?? stage;

  switch (tone) {
    case 'frank': return `[${name}に入ったよ！]`;
    case 'aniki': return `[${name}突入だ]`;
    case 'neutral': return `[ステージ: ${name}]`;
    default: return `[${name}に進みました]`;
  }
}

function getAllDoneFeedback(tone: string, mType: string | null): string {
  let base: string;
  switch (tone) {
    case 'frank': base = '今日は全部達成！お疲れ！'; break;
    case 'aniki': base = '全達成。よくやった。'; break;
    case 'neutral': base = '本日: 全項目達成。'; break;
    default: base = '今日はすべて達成です。お疲れさまでした。'; break;
  }

  // M3（他者駆動）: 報告文脈を追加
  if (mType === 'M3') {
    base += '\n報告ありがとうございます。';
  }

  return base;
}

function getPartialFeedback(tone: string, done: number, total: number): string {
  const remaining = total - done;
  switch (tone) {
    case 'frank': return `${done}/${total}完了。あと${remaining}個！`;
    case 'aniki': return `${done}/${total}。残り${remaining}個、取りに行け。`;
    case 'neutral': return `進捗: ${done}/${total}。残り${remaining}件。`;
    default: return `${done}/${total}完了です。残り${remaining}個、頑張りましょう。`;
  }
}

