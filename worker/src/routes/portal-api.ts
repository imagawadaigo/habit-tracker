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
      'https://imagawadaigo.github.io',
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
// GET /portal/logs/month?month=YYYY-MM — 月別ログ取得
// ========================================
api.get('/logs/month', async (c) => {
  const { userId, supabase } = ctx(c);
  const month = c.req.query('month');
  if (!month) return c.json({ error: 'month required (YYYY-MM)' }, 400);

  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const { data } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false });

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

// ========================================
// GET /portal/review/daily?date=YYYY-MM-DD — 日次振り返り
// ========================================
api.get('/review/daily', async (c) => {
  const { userId, supabase } = ctx(c);
  const date = c.req.query('date');
  if (!date) return c.json({ error: 'date required' }, 400);

  const [{ data: habits }, { data: records }, { data: log }] = await Promise.all([
    supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('habit_records').select('*').eq('user_id', userId).eq('date', date),
    supabase.from('daily_logs').select('*').eq('user_id', userId).eq('date', date).single(),
  ]);

  const habitResults = (habits ?? []).map((h: any) => {
    const rec = (records ?? []).find((r: any) => r.habit_id === h.id);
    return {
      name: h.name,
      status: rec?.status ?? 'not_recorded',
      achievement_line: h.achievement_line,
      minimum_line: h.minimum_line,
    };
  });

  return c.json({
    date,
    habits: habitResults,
    log: log ?? null,
  });
});

// ========================================
// GET /portal/review/weekly?week=YYYY-MM-DD — 週次振り返り（月曜始まり、dateはその週の任意の日）
// ========================================
api.get('/review/weekly', async (c) => {
  const { userId, supabase } = ctx(c);
  const dateParam = c.req.query('week');
  if (!dateParam) return c.json({ error: 'week required (YYYY-MM-DD)' }, 400);

  // 月曜始まりの週を計算
  const d = new Date(dateParam + 'T00:00:00+09:00');
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const start = monday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const end = sunday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const [{ data: habits }, { data: records }, { data: logs }] = await Promise.all([
    supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('habit_records').select('*').eq('user_id', userId).gte('date', start).lte('date', end),
    supabase.from('daily_logs').select('*').eq('user_id', userId).gte('date', start).lte('date', end).order('date'),
  ]);

  // 日別サマリー
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push(day.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  }

  const dailySummary = days.map(day => {
    const dayRecs = (records ?? []).filter((r: any) => r.date === day);
    const achieved = dayRecs.filter((r: any) => r.status === 'achieved').length;
    const minimum = dayRecs.filter((r: any) => r.status === 'minimum').length;
    const total = (habits ?? []).length;
    return { date: day, achieved, minimum, total, rate: total > 0 ? Math.round(((achieved + minimum) / total) * 100) : 0 };
  });

  // 習慣別サマリー
  const habitSummary = (habits ?? []).map((h: any) => {
    const habitRecs = (records ?? []).filter((r: any) => r.habit_id === h.id);
    const achieved = habitRecs.filter((r: any) => r.status === 'achieved').length;
    const minimum = habitRecs.filter((r: any) => r.status === 'minimum').length;
    return {
      name: h.name,
      achieved,
      minimum,
      total: 7,
      rate: Math.round(((achieved + minimum) / 7) * 100),
      current_streak: h.current_streak,
      max_streak: h.max_streak,
    };
  });

  // ログからハイライト抽出
  const highlights = (logs ?? [])
    .filter((l: any) => l.highlight)
    .map((l: any) => ({ date: l.date, highlight: l.highlight }));

  const totalAchieved = dailySummary.reduce((s, d) => s + d.achieved + d.minimum, 0);
  const totalPossible = dailySummary.reduce((s, d) => s + d.total, 0);

  return c.json({
    start,
    end,
    overallRate: totalPossible > 0 ? Math.round((totalAchieved / totalPossible) * 100) : 0,
    dailySummary,
    habitSummary,
    highlights,
    logs: logs ?? [],
  });
});

// ========================================
// GET /portal/review/monthly?month=YYYY-MM — 月次振り返り
// ========================================
api.get('/review/monthly', async (c) => {
  const { userId, supabase } = ctx(c);
  const month = c.req.query('month');
  if (!month) return c.json({ error: 'month required (YYYY-MM)' }, 400);

  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const [{ data: habits }, { data: records }, { data: logs }, { data: levelUps }] = await Promise.all([
    supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('habit_records').select('*').eq('user_id', userId).gte('date', start).lte('date', end),
    supabase.from('daily_logs').select('*').eq('user_id', userId).gte('date', start).lte('date', end).order('date'),
    supabase.from('level_up_history').select('*').eq('user_id', userId).gte('created_at', start + 'T00:00:00+09:00').lte('created_at', end + 'T23:59:59+09:00').order('created_at'),
  ]);

  // 習慣別月間サマリー
  const habitSummary = (habits ?? []).map((h: any) => {
    const habitRecs = (records ?? []).filter((r: any) => r.habit_id === h.id);
    const achieved = habitRecs.filter((r: any) => r.status === 'achieved').length;
    const minimum = habitRecs.filter((r: any) => r.status === 'minimum').length;
    const habitCreated = h.created_at ? h.created_at.split('T')[0] : start;
    const eligibleDays = Array.from({ length: daysInMonth }, (_, i) => {
      const day = `${month}-${String(i + 1).padStart(2, '0')}`;
      return day >= habitCreated && day <= end ? 1 : 0;
    }).reduce((a: number, b: number) => a + b, 0 as number);

    return {
      name: h.name,
      achieved,
      minimum,
      eligibleDays,
      rate: eligibleDays > 0 ? Math.round(((achieved + minimum) / eligibleDays) * 100) : 0,
      current_streak: h.current_streak,
      max_streak: h.max_streak,
    };
  });

  // 日別達成率カレンダーデータ
  const calendar = Array.from({ length: daysInMonth }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    const dayRecs = (records ?? []).filter((r: any) => r.date === day);
    const done = dayRecs.filter((r: any) => r.status === 'achieved' || r.status === 'minimum').length;
    const total = (habits ?? []).length;
    return { date: day, done, total, rate: total > 0 ? Math.round((done / total) * 100) : 0 };
  });

  // ハイライト
  const highlights = (logs ?? [])
    .filter((l: any) => l.highlight)
    .map((l: any) => ({ date: l.date, highlight: l.highlight }));

  const totalDone = calendar.reduce((s, d) => s + d.done, 0);
  const totalPossible = calendar.reduce((s, d) => s + d.total, 0);

  return c.json({
    month,
    overallRate: totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0,
    calendar,
    habitSummary,
    highlights,
    levelUps: (levelUps ?? []).map((l: any) => ({ level: l.new_level, xp: l.total_xp, date: l.created_at })),
  });
});

// ========================================
// GET /portal/level-history — レベルアップ履歴
// ========================================
api.get('/level-history', async (c) => {
  const { userId, supabase } = ctx(c);
  const { data } = await supabase
    .from('level_up_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  return c.json(data ?? []);
});

export { api as portalApi };
