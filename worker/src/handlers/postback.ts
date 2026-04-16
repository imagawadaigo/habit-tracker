import { SupabaseClient } from '@supabase/supabase-js';
import type { Env, User, UserProfile, LineEvent, LineMessage } from '../types';
import { replyMessage, textMessage, flexMessage } from '../lib/line';
import { upsertProfile, getActiveHabits, getTodayRecords, getRecentRecords, recordHabits } from '../lib/supabase';
import { buildHabitListFlex, buildLevelUpFlex } from '../lib/flex';
import { evaluateStage } from '../lib/stage';
import { calcRecordXp, grantXp, xpToNextLevel } from '../lib/xp';
import {
  onboardingQ2, onboardingQ3, onboardingQ4, onboardingQ5, onboardingQ6,
  onboardingResult, onboardingToneSelect, onboardingRhythm, onboardingComplete,
  determineType, recommendStyle,
  MOTIVATION_LABELS, FAILURE_LABELS, RECOVERY_LABELS,
  onboardingQ1,
} from './onboarding-steps';

export async function handlePostback(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  profile: UserProfile | null,
  event: LineEvent
) {
  const data = event.postback?.data;
  if (!data) return;

  const params = new URLSearchParams(data);
  const action = params.get('action');
  const value = params.get('value') ?? '';

  switch (action) {
    // === 64類型プロファイリング ===

    case 'profiling_q1': {
      await upsertProfile(supabase, user.id, { motivation_q1: value, onboarding_step: 3 } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('動機の源泉 (2/2)', onboardingQ2()),
      ]);
      break;
    }

    case 'profiling_q2': {
      const q1 = profile?.motivation_q1 ?? 'A';
      const { primary, secondary } = determineType(q1, value);
      const mType = `M${primary}`;
      await upsertProfile(supabase, user.id, {
        motivation_q2: value,
        motivation_type: mType,
        motivation_secondary: secondary ? `M${secondary}` : null,
        onboarding_step: 4,
      } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('挫折の構造 (1/2)', onboardingQ3()),
      ]);
      break;
    }

    case 'profiling_q3': {
      await upsertProfile(supabase, user.id, { failure_q3: value, onboarding_step: 5 } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('挫折の構造 (2/2)', onboardingQ4()),
      ]);
      break;
    }

    case 'profiling_q4': {
      const q3 = profile?.failure_q3 ?? 'A';
      const { primary, secondary } = determineType(q3, value);
      const fType = `F${primary}`;
      await upsertProfile(supabase, user.id, {
        failure_q4: value,
        failure_type: fType,
        failure_secondary: secondary ? `F${secondary}` : null,
        onboarding_step: 6,
      } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('回復の型 (1/2)', onboardingQ5()),
      ]);
      break;
    }

    case 'profiling_q5': {
      await upsertProfile(supabase, user.id, { recovery_q5: value, onboarding_step: 7 } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('回復の型 (2/2)', onboardingQ6()),
      ]);
      break;
    }

    case 'profiling_q6': {
      const q5 = profile?.recovery_q5 ?? 'A';
      const { primary, secondary } = determineType(q5, value);
      const rType = `R${primary}`;

      // 全軸の最新値を取得してプロファイル更新
      const latestProfile = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      const lp = latestProfile.data;

      const mType = lp?.motivation_type ?? 'M3';
      const fType = lp?.failure_type ?? 'F1';
      const typeCode = `${mType}-${fType}-${rType}`;
      const autoStyle = recommendStyle(mType, fType, rType);
      const styleLabel: Record<string, string> = { gentle: '優しめ', balanced: 'バランス', strict: '厳しめ' };

      await upsertProfile(supabase, user.id, {
        recovery_q6: value,
        recovery_type: rType,
        recovery_secondary: secondary ? `R${secondary}` : null,
        type_code: typeCode,
        coach_style: autoStyle,
        coach_style_auto: autoStyle,
        onboarding_step: 8,
      } as Partial<UserProfile>);

      const mInfo = MOTIVATION_LABELS[mType] ?? MOTIVATION_LABELS['M3'];
      const fInfo = FAILURE_LABELS[fType] ?? FAILURE_LABELS['F1'];
      const rInfo = RECOVERY_LABELS[rType] ?? RECOVERY_LABELS['R4'];

      await replyMessage(env, event.replyToken, [
        flexMessage('あなたの習慣化プロファイル', onboardingResult({
          motivationLabel: mInfo.label,
          motivationDesc: mInfo.desc,
          failureLabel: fInfo.label,
          failureDesc: fInfo.desc,
          recoveryLabel: rInfo.label,
          recoveryDesc: rInfo.desc,
          recommendedStyle: styleLabel[autoStyle],
        })),
      ]);
      break;
    }

    // === 関わり方確認 ===

    case 'onboarding_style_confirm': {
      let style: string;
      if (value === 'auto') {
        style = profile?.coach_style_auto ?? profile?.coach_style ?? 'balanced';
      } else {
        style = value;
      }
      await upsertProfile(supabase, user.id, {
        coach_style: style as 'gentle' | 'balanced' | 'strict',
        onboarding_step: 9,
      } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('コーチの話し方を選んでください', onboardingToneSelect()),
      ]);
      break;
    }

    // === 話し方選択 ===

    case 'onboarding_tone': {
      const tone = value as 'polite' | 'frank' | 'aniki' | 'neutral';
      await upsertProfile(supabase, user.id, {
        coach_tone: tone,
        onboarding_step: 10,
      } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        flexMessage('生活リズムを教えてください', onboardingRhythm()),
      ]);
      break;
    }

    // === 生活リズム → 完了 ===

    case 'onboarding_rhythm': {
      const rhythm = value as 'morning' | 'night' | 'irregular';
      const defaults: Record<string, { morning: string; evening: string }> = {
        morning: { morning: '07:00', evening: '21:00' },
        night: { morning: '09:00', evening: '23:00' },
        irregular: { morning: '08:00', evening: '22:00' },
      };

      await upsertProfile(supabase, user.id, {
        life_rhythm: rhythm,
        morning_notify_time: defaults[rhythm].morning,
        evening_notify_time: defaults[rhythm].evening,
        onboarding_step: 0,
      } as Partial<UserProfile>);

      await supabase
        .from('users')
        .update({ onboarding_completed: true })
        .eq('id', user.id);

      const updated = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      await replyMessage(env, event.replyToken, [
        flexMessage('設定完了', onboardingComplete(updated.data)),
        textMessage(
          '設定が完了しました。\n\n最初の習慣を追加しましょう。\n「追加 朝散歩」のように送ってください。'
        ),
      ]);
      break;
    }

    // === リッチメニューからの操作 ===

    case 'menu_record':
    case 'menu_list': {
      try {
        const habits = await getActiveHabits(supabase, user.id);
        if (habits.length === 0) {
          await replyMessage(env, event.replyToken, [
            textMessage('まだ習慣が登録されていません。\n「追加 朝散歩」のように送ってください。'),
          ]);
          break;
        }
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        const [todayRecs, weekRecs] = await Promise.all([
          getTodayRecords(supabase, user.id, today),
          getRecentRecords(supabase, user.id, 7),
        ]);
        const flexContent = buildHabitListFlex(habits, todayRecs, weekRecs, today, profile);
        await replyMessage(env, event.replyToken, [
          flexMessage('習慣一覧', flexContent),
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[menu_list] error:', msg);
        try {
          await replyMessage(env, event.replyToken, [
            textMessage('一覧の表示でエラーが発生しました。もう一度お試しください。'),
          ]);
        } catch { /* replyToken already consumed */ }
      }
      break;
    }

    case 'menu_settings': {
      // 設定メニューを直接表示
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
              { type: 'button', action: { type: 'postback', label: '関わり方を変更', data: 'action=menu_change_style', displayText: '関わり方を変更' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '話し方を変更', data: 'action=menu_change_tone', displayText: '話し方を変更' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: 'タイプ診断をやり直す', data: 'action=menu_reprofile', displayText: 'タイプ診断をやり直す' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: 'プロファイル全リセット', data: 'action=menu_reset_profile', displayText: 'プロファイル全リセット' }, style: 'secondary', height: 'sm' },
            ],
            paddingAll: 'lg',
          },
        }),
      ]);
      break;
    }

    case 'menu_help': {
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
            '設定 ... 関わり方・話し方の変更',
            'リセット ... 全データを初期化',
            'プロファイルリセット ... プロファイルのみ再設定',
            'ヘルプ ... この案内を表示',
          ].join('\n')
        ),
      ]);
      break;
    }

    case 'menu_reset_profile': {
      // プロファイルリセット
      await supabase.from('user_profiles').delete().eq('user_id', user.id);
      await supabase.from('users').update({ onboarding_completed: false }).eq('id', user.id);
      await upsertProfile(supabase, user.id, {
        onboarding_step: 1,
        coach_style: 'balanced',
        coach_tone: 'polite',
        reminder_frequency: 'normal',
        failure_patterns: [],
      } as Partial<UserProfile>);
      await replyMessage(env, event.replyToken, [
        textMessage('プロファイルをリセットしました。\nニックネームを教えてください。'),
      ]);
      break;
    }

    case 'menu_change_style': {
      const latestProfile = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      const lp = latestProfile.data;
      const mType = lp?.motivation_type ?? 'M3';
      const fType = lp?.failure_type ?? 'F1';
      const rType = lp?.recovery_type ?? 'R4';
      const autoStyle = recommendStyle(mType, fType, rType);
      const styleLabel: Record<string, string> = { gentle: '優しめ', balanced: 'バランス', strict: '厳しめ' };
      const mInfo = MOTIVATION_LABELS[mType] ?? MOTIVATION_LABELS['M3'];
      const fInfo = FAILURE_LABELS[fType] ?? FAILURE_LABELS['F1'];
      const rInfo = RECOVERY_LABELS[rType] ?? RECOVERY_LABELS['R4'];

      await replyMessage(env, event.replyToken, [
        flexMessage('関わり方を変更', onboardingResult({
          motivationLabel: mInfo.label,
          motivationDesc: mInfo.desc,
          failureLabel: fInfo.label,
          failureDesc: fInfo.desc,
          recoveryLabel: rInfo.label,
          recoveryDesc: rInfo.desc,
          recommendedStyle: styleLabel[autoStyle],
        })),
      ]);
      break;
    }

    case 'menu_change_tone': {
      await replyMessage(env, event.replyToken, [
        flexMessage('話し方を変更', onboardingToneSelect()),
      ]);
      break;
    }

    case 'menu_reprofile': {
      // 64類型の再プロファイリング（習慣データは保持）
      await upsertProfile(supabase, user.id, {
        motivation_type: null,
        motivation_secondary: null,
        motivation_q1: null,
        motivation_q2: null,
        failure_type: null,
        failure_secondary: null,
        failure_q3: null,
        failure_q4: null,
        recovery_type: null,
        recovery_secondary: null,
        recovery_q5: null,
        recovery_q6: null,
        type_code: null,
        coach_style_auto: null,
        onboarding_step: 2,
      } as Partial<UserProfile>);
      await supabase.from('users').update({ onboarding_completed: false }).eq('id', user.id);
      await replyMessage(env, event.replyToken, [
        textMessage('プロファイリングをやり直します。\n6つの質問に答えてください。'),
        flexMessage('動機の源泉 (1/2)', onboardingQ1()),
      ]);
      break;
    }

    // === Flexからのクイック記録 ===

    case 'quick_record': {
      const index = parseInt(params.get('index') ?? '0', 10);
      const status = params.get('status') as 'achieved' | 'minimum';
      if (!index || !status) break;

      const habits = await getActiveHabits(supabase, user.id);
      if (index < 1 || index > habits.length) break;

      const habit = habits[index - 1];
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

      await recordHabits(supabase, user.id, today, [{ habitId: habit.id, status }]);
      await evaluateStage(supabase, user.id, habit.id);

      // 更新後のストリーク・記録を取得
      const updatedHabits = await getActiveHabits(supabase, user.id);
      const updated = updatedHabits.find(h => h.id === habit.id);
      const streak = updated?.current_streak ?? 0;

      // XP付与
      const todayRecs = await getTodayRecords(supabase, user.id, today);
      const allComplete = habits.every(h => todayRecs.some(r => r.habit_id === h.id && (r.status === 'achieved' || r.status === 'minimum')));
      const xpGained = calcRecordXp([{ status }], [{ streak }], allComplete);
      const xpResult = await grantXp(supabase, user.id, xpGained);

      const mark = status === 'achieved' ? '[x]' : '[/]';
      let msg = `${mark} ${habit.name}${streak > 0 ? ` (${streak}d)` : ''}`;
      msg += `\n+${xpResult.xpGained} XP`;
      if (xpResult.leveledUp) {
        msg += ` >> Lv.${xpResult.level} UP!`;
      }
      if (allComplete) {
        msg += '\n\n全習慣達成!';
      }

      // 更新後のプロフィールを取得してFlex再表示
      const { data: updatedProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const weekRecs = await getRecentRecords(supabase, user.id, 7);

      const messages: LineMessage[] = [textMessage(msg)];
      if (xpResult.leveledUp) {
        messages.push(flexMessage('LEVEL UP!', buildLevelUpFlex(xpResult.level, xpResult.totalXp, profile?.nickname)));
      }
      messages.push(flexMessage('習慣一覧', buildHabitListFlex(updatedHabits, todayRecs, weekRecs, today, updatedProfile)));
      await replyMessage(env, event.replyToken, messages);
      break;
    }
  }
}
