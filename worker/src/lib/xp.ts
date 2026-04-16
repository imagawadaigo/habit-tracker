import { SupabaseClient } from '@supabase/supabase-js';

// === XP テーブル ===

const XP_HABIT_ACHIEVED = 10;
const XP_HABIT_MINIMUM = 5;
const XP_ALL_COMPLETE_BONUS = 20;
const XP_LOG = 10;

const STREAK_BONUSES: Array<{ threshold: number; xp: number }> = [
  { threshold: 30, xp: 50 },
  { threshold: 7, xp: 15 },
  { threshold: 3, xp: 5 },
];

// === レベルテーブル ===
// Lv1=0, Lv2=50, Lv3=150, Lv4=300, Lv5=500, Lv6=750, Lv7=1050, ...
// 公式: 必要累計XP = 25 * level * (level - 1)

export function xpForLevel(level: number): number {
  return 25 * level * (level - 1);
}

export function levelFromXp(totalXp: number): number {
  // 25 * L * (L-1) <= totalXp を満たす最大L
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) {
    level++;
  }
  return level;
}

export function xpToNextLevel(totalXp: number): { current: number; needed: number; progress: number } {
  const level = levelFromXp(totalXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const range = nextLevelXp - currentLevelXp;
  const progress = totalXp - currentLevelXp;
  return { current: progress, needed: range, progress: range > 0 ? progress / range : 0 };
}

// === XP 付与 ===

export interface XpGainResult {
  xpGained: number;
  totalXp: number;
  level: number;
  leveledUp: boolean;
  prevLevel: number;
}

/** 習慣記録時のXP計算 */
export function calcRecordXp(
  records: Array<{ status: 'achieved' | 'minimum' }>,
  streaks: Array<{ streak: number }>,
  allComplete: boolean
): number {
  let xp = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    xp += r.status === 'achieved' ? XP_HABIT_ACHIEVED : XP_HABIT_MINIMUM;

    // ストリークボーナス（ちょうどその閾値に到達した時のみ）
    const streak = streaks[i]?.streak ?? 0;
    for (const bonus of STREAK_BONUSES) {
      if (streak === bonus.threshold) {
        xp += bonus.xp;
        break;
      }
    }
  }

  if (allComplete) {
    xp += XP_ALL_COMPLETE_BONUS;
  }

  return xp;
}

/** ログ記録時のXP */
export function calcLogXp(): number {
  return XP_LOG;
}

/** XPを付与してレベルを更新 */
export async function grantXp(
  supabase: SupabaseClient,
  userId: string,
  xpGained: number
): Promise<XpGainResult> {
  // 現在のXPを取得
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('total_xp, level')
    .eq('user_id', userId)
    .single();

  const prevXp = profile?.total_xp ?? 0;
  const prevLevel = profile?.level ?? 1;
  const newXp = prevXp + xpGained;
  const newLevel = levelFromXp(newXp);

  await supabase
    .from('user_profiles')
    .update({ total_xp: newXp, level: newLevel })
    .eq('user_id', userId);

  return {
    xpGained,
    totalXp: newXp,
    level: newLevel,
    leveledUp: newLevel > prevLevel,
    prevLevel,
  };
}
