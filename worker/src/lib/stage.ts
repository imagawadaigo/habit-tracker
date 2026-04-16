import type { SupabaseClient } from '@supabase/supabase-js';
import type { HabitStage } from '../types';

type Stage = HabitStage['current_stage'];

/**
 * 習慣のステージを再評価し、必要なら更新する。
 * coaching-logic.md「ステージ遷移の自動判定ロジック」の実装。
 */
export async function evaluateStage(
  supabase: SupabaseClient,
  userId: string,
  habitId: string
): Promise<{ stage: Stage; changed: boolean; crisis: boolean }> {
  // 習慣の作成日を取得
  const { data: habit } = await supabase
    .from('habits')
    .select('created_at')
    .eq('id', habitId)
    .single();

  if (!habit) return { stage: 'preparation', changed: false, crisis: false };

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const createdAt = new Date(habit.created_at);
  const now = new Date();
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);

  // 直近7日・14日の達成率を計算
  const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { data: recentRecords } = await supabase
    .from('habit_records')
    .select('date, status')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .gte('date', twoWeeksAgo)
    .lte('date', today);

  const records = recentRecords ?? [];

  // 直近7日の達成率（achieved + minimum = 達成とみなす）
  const last7 = records.filter((r) => r.date >= weekAgo);
  const last7Rate = last7.length > 0
    ? last7.filter((r) => r.status === 'achieved' || r.status === 'minimum').length / 7
    : 0;

  // 前の7日（8-14日前）の達成率
  const prev7 = records.filter((r) => r.date < weekAgo);
  const prev7Rate = prev7.length > 0
    ? prev7.filter((r) => r.status === 'achieved' || r.status === 'minimum').length / 7
    : 0;

  // 直近14日の達成率
  const last14Rate = records.length > 0
    ? records.filter((r) => r.status === 'achieved' || r.status === 'minimum').length / 14
    : 0;

  // 危機判定: 直近2日が連続未達
  const crisis = await detectCrisis(supabase, userId, habitId);

  // ステージ判定
  let newStage: Stage;

  if (daysSinceCreation <= 7) {
    newStage = 'preparation';
  } else if (daysSinceCreation <= 21) {
    newStage = last7Rate >= 0.5 ? 'execution_early' : 'preparation';
  } else if (daysSinceCreation <= 49) {
    newStage = last7Rate >= 0.5 ? 'execution_mid' : 'execution_early';
  } else {
    newStage = last14Rate >= 0.7 ? 'established' : 'execution_mid';
  }

  // 後退判定: 直近7日達成率 < 前7日達成率 - 30%
  if (prev7Rate - last7Rate > 0.3) {
    const stageOrder: Stage[] = ['preparation', 'execution_early', 'execution_mid', 'established'];
    const currentIdx = stageOrder.indexOf(newStage);
    if (currentIdx > 0) {
      newStage = stageOrder[currentIdx - 1];
    }
  }

  // 現在のステージを取得
  const { data: currentStageData } = await supabase
    .from('habit_stages')
    .select('current_stage, crisis_count')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .single();

  const oldStage = (currentStageData?.current_stage as Stage) ?? 'preparation';
  const crisisCount = (currentStageData?.crisis_count as number) ?? 0;
  const changed = oldStage !== newStage;

  // upsert
  await supabase
    .from('habit_stages')
    .upsert(
      {
        user_id: userId,
        habit_id: habitId,
        current_stage: newStage,
        stage_entered_at: changed ? new Date().toISOString() : undefined,
        crisis_count: crisis ? crisisCount + 1 : crisisCount,
        last_7day_rate: Math.round(last7Rate * 100),
        prev_7day_rate: Math.round(prev7Rate * 100),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,habit_id' }
    );

  return { stage: newStage, changed, crisis };
}

/**
 * 2日連続未達を検知する。
 */
export async function detectCrisis(
  supabase: SupabaseClient,
  userId: string,
  habitId: string
): Promise<boolean> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const dayBefore = new Date(Date.now() - 2 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { data: records } = await supabase
    .from('habit_records')
    .select('date, status')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .in('date', [yesterday, dayBefore]);

  // 昨日と一昨日の両方が「記録なし」または「missed」なら危機
  const yesterdayRecord = (records ?? []).find((r) => r.date === yesterday);
  const dayBeforeRecord = (records ?? []).find((r) => r.date === dayBefore);

  const yesterdayMissed = !yesterdayRecord || yesterdayRecord.status === 'missed';
  const dayBeforeMissed = !dayBeforeRecord || dayBeforeRecord.status === 'missed';

  return yesterdayMissed && dayBeforeMissed;
}

/**
 * ユーザーの全アクティブ習慣のステージを取得する。
 */
export async function getHabitStages(
  supabase: SupabaseClient,
  userId: string
): Promise<Map<string, { stage: Stage; last7Rate: number; crisis_count: number }>> {
  const { data } = await supabase
    .from('habit_stages')
    .select('habit_id, current_stage, last_7day_rate, crisis_count')
    .eq('user_id', userId);

  const map = new Map<string, { stage: Stage; last7Rate: number; crisis_count: number }>();
  for (const row of data ?? []) {
    map.set(row.habit_id, {
      stage: row.current_stage as Stage,
      last7Rate: row.last_7day_rate ?? 0,
      crisis_count: row.crisis_count ?? 0,
    });
  }
  return map;
}
