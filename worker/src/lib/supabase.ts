import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env, User, UserProfile, Habit, HabitRecord, DailyLog } from '../types';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// === User ===

export async function getOrCreateUser(
  supabase: SupabaseClient,
  lineUserId: string,
  displayName?: string
): Promise<User> {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .single();

  if (existing) return existing as User;

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      line_user_id: lineUserId,
      display_name: displayName ?? null,
      coach_phase: 'early',
      onboarding_completed: false,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return created as User;
}

// === Profile ===

export async function getProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  return data as UserProfile | null;
}

export async function upsertProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<UserProfile>
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert profile: ${error.message}`);
  return data as UserProfile;
}

// === Habits ===

export async function getActiveHabits(
  supabase: SupabaseClient,
  userId: string
): Promise<Habit[]> {
  const { data } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order');
  return (data ?? []) as Habit[];
}

export async function addHabit(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  category: 'action' | 'lifestyle' = 'action'
): Promise<Habit> {
  // 次のsort_orderを取得
  const { data: existing } = await supabase
    .from('habits')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? (existing[0].sort_order as number) + 1 : 1;

  const { data, error } = await supabase
    .from('habits')
    .insert({
      user_id: userId,
      name,
      category,
      sort_order: nextOrder,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add habit: ${error.message}`);
  return data as Habit;
}

export async function deactivateHabit(
  supabase: SupabaseClient,
  userId: string,
  habitName: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('habits')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('name', habitName)
    .eq('is_active', true)
    .select();

  if (error) throw new Error(`Failed to deactivate habit: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// === Habit Records ===

export async function recordHabits(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  records: Array<{ habitId: string; status: 'achieved' | 'minimum' | 'missed' }>
): Promise<void> {
  const rows = records.map((r) => ({
    user_id: userId,
    habit_id: r.habitId,
    date,
    status: r.status,
  }));

  const { error } = await supabase
    .from('habit_records')
    .upsert(rows, { onConflict: 'user_id,habit_id,date' });

  if (error) throw new Error(`Failed to record habits: ${error.message}`);

  // ストリーク更新
  for (const r of records) {
    if (r.status === 'achieved' || r.status === 'minimum') {
      await updateStreak(supabase, userId, r.habitId, date);
    } else {
      // missed → ストリークリセット
      await supabase
        .from('habits')
        .update({ current_streak: 0 })
        .eq('id', r.habitId);
    }
  }
}

/**
 * ストリークを更新する。
 * 昨日の記録があれば+1、なければ1にリセット。max_streakも更新。
 */
async function updateStreak(
  supabase: SupabaseClient,
  userId: string,
  habitId: string,
  date: string
): Promise<void> {
  const yesterday = new Date(new Date(date).getTime() - 86400000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { data: yesterdayRecord } = await supabase
    .from('habit_records')
    .select('status')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .eq('date', yesterday)
    .single();

  const { data: habit } = await supabase
    .from('habits')
    .select('current_streak, max_streak')
    .eq('id', habitId)
    .single();

  const prevStreak = habit?.current_streak ?? 0;
  const maxStreak = habit?.max_streak ?? 0;

  // 昨日も達成/最低ラインなら連続、そうでなければ1からスタート
  const yesterdayOk = yesterdayRecord &&
    (yesterdayRecord.status === 'achieved' || yesterdayRecord.status === 'minimum');
  const newStreak = yesterdayOk ? prevStreak + 1 : 1;
  const newMax = Math.max(maxStreak, newStreak);

  await supabase
    .from('habits')
    .update({ current_streak: newStreak, max_streak: newMax })
    .eq('id', habitId);
}

export async function getTodayRecords(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<HabitRecord[]> {
  const { data } = await supabase
    .from('habit_records')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date);
  return (data ?? []) as HabitRecord[];
}

// === Daily Log ===

export async function upsertDailyLog(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  updates: Partial<DailyLog>
): Promise<DailyLog> {
  const { data, error } = await supabase
    .from('daily_logs')
    .upsert({ user_id: userId, date, ...updates }, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert daily log: ${error.message}`);
  return data as DailyLog;
}
