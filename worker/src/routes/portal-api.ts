import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import { getSupabase } from '../lib/supabase';
import {
  getActiveHabits,
  addHabit,
  deactivateHabit,
  recordHabits,
  getTodayRecords,
  upsertDailyLog,
} from '../lib/supabase';
import { evaluateStage } from '../lib/stage';

const api = new Hono<{ Bindings: Env }>();

// CORS: GitHub Pages + LIFF
api.use(
  '*',
  cors({
    origin: [
      'https://bkdj5.github.io',
      'https://liff.line.me',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Line-UserId'],
  })
);

/**
 * LINE User ID -> internal user_id を解決するミドルウェア。
 * ヘッダー X-Line-UserId を必須とする。
 */
api.use('*', async (c, next) => {
  const lineUserId = c.req.header('X-Line-UserId');
  if (!lineUserId) {
    return c.json({ error: 'X-Line-UserId header required' }, 401);
  }

  const supabase = getSupabase(c.env);
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('line_user_id', lineUserId)
    .single();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  c.set('userId' as never, user.id);
  c.set('supabase' as never, supabase);
  await next();
});

// Helper to extract context
function ctx(c: any) {
  return {
    userId: c.get('userId') as string,
    supabase: c.get('supabase') as ReturnType<typeof getSupabase>,
  };
}

// ========================================
// GET /portal/habits — アクティブ習慣一覧
// ========================================
api.get('/habits', async (c) => {
  const { userId, supabase } = ctx(c);
  const habits = await getActiveHabits(supabase, userId);
  return c.json(habits);
});

// ========================================
// POST /portal/habits — 習慣追加
// ========================================
api.post('/habits', async (c) => {
  const { userId, supabase } = ctx(c);
  const body = await c.req.json<{
    name: string;
    category?: 'action' | 'lifestyle';
    achievement_line?: string;
    minimum_line?: string;
    anchor_habit?: string;
  }>();

  if (!body.name) {
    return c.json({ error: 'name required' }, 400);
  }

  const habit = await addHabit(supabase, userId, body.name, body.category ?? 'action');

  // 追加オプション（達成ライン等）があれば更新
  const updates: Record<string, string | null> = {};
  if (body.achievement_line) updates.achievement_line = body.achievement_line;
  if (body.minimum_line) updates.minimum_line = body.minimum_line;
  if (body.anchor_habit) updates.anchor_habit = body.anchor_habit;

  if (Object.keys(updates).length > 0) {
    await supabase.from('habits').update(updates).eq('id', habit.id);
  }

  return c.json(habit, 201);
});

// ========================================
// PUT /portal/habits/:id — 習慣編集
// ========================================
api.put('/habits/:id', async (c) => {
  const { userId, supabase } = ctx(c);
  const habitId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    achievement_line?: string | null;
    minimum_line?: string | null;
    anchor_habit?: string | null;
  }>();

  const { data, error } = await supabase
    .from('habits')
    .update(body)
    .eq('id', habitId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

// ========================================
// DELETE /portal/habits/:id — 習慣無効化
// ========================================
api.delete('/habits/:id', async (c) => {
  const { userId, supabase } = ctx(c);
  const habitId = c.req.param('id');

  const { error } = await supabase
    .from('habits')
    .update({ is_active: false })
    .eq('id', habitId)
    .eq('user_id', userId);

  if (error) return c.json({ error: error.message }, 400);
  return c.json({ status: 'ok' });
});

// ========================================
// GET /portal/records?date=YYYY-MM-DD — 日別記録取得
// ========================================
api.get('/records', async (c) => {
  const { userId, supabase } = ctx(c);
  const date = c.req.query('date');
  if (!date) return c.json({ error: 'date required' }, 400);

  const records = await getTodayRecords(supabase, userId, date);
  return c.json(records);
});

// ========================================
// GET /portal/records/month?month=YYYY-MM — 月間記録取得
// ========================================
api.get('/records/month', async (c) => {
  const { userId, supabase } = ctx(c);
  const month = c.req.query('month'); // YYYY-MM
  if (!month) return c.json({ error: 'month required (YYYY-MM)' }, 400);

  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const { data } = await supabase
    .from('habit_records')
    .select('*')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end);

  return c.json(data ?? []);
});

// ========================================
// POST /portal/records — 記録保存（複数習慣一括）
// ========================================
api.post('/records', async (c) => {
  const { userId, supabase } = ctx(c);
  const body = await c.req.json<{
    date: string;
    records: Array<{ habitId: string; status: 'achieved' | 'minimum' | 'missed' }>;
  }>();

  if (!body.date || !body.records?.length) {
    return c.json({ error: 'date and records required' }, 400);
  }

  await recordHabits(supabase, userId, body.date, body.records);

  // ステージ再評価
  for (const r of body.records) {
    await evaluateStage(supabase, userId, r.habitId);
  }

  // 更新後の習慣（ストリーク込み）を返す
  const habits = await getActiveHabits(supabase, userId);
  return c.json({ status: 'ok', habits });
});

// ========================================
// GET /portal/logs?limit=N — 日次ログ一覧
// ========================================
api.get('/logs', async (c) => {
  const { userId, supabase } = ctx(c);
  const limit = parseInt(c.req.query('limit') ?? '14');

  const { data } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit);

  return c.json(data ?? []);
});

// ========================================
// POST /portal/logs — 日次ログ保存
// ========================================
api.post('/logs', async (c) => {
  const { userId, supabase } = ctx(c);
  const body = await c.req.json<{
    date: string;
    focus?: string;
    highlight?: string;
    kpt_keep?: string;
    kpt_problem?: string;
    kpt_try?: string;
  }>();

  if (!body.date) return c.json({ error: 'date required' }, 400);

  const log = await upsertDailyLog(supabase, userId, body.date, body);
  return c.json(log);
});

// ========================================
// GET /portal/profile — ユーザープロファイル
// ========================================
api.get('/profile', async (c) => {
  const { userId, supabase } = ctx(c);

  const [{ data: user }, { data: profile }, { data: stages }] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('user_profiles').select('*').eq('user_id', userId).single(),
    supabase.from('habit_stages').select('*').eq('user_id', userId),
  ]);

  return c.json({ user, profile, stages: stages ?? [] });
});

export { api as portalApi };
