import { Hono } from 'hono';
import type { Env } from './types';
import { webhook } from './routes/webhook';
import { portalApi } from './routes/portal-api';
import { morningPush, eveningPush } from './handlers/cron';
import { getSupabase } from './lib/supabase';

const app = new Hono<{ Bindings: Env }>();

// ヘルスチェック
app.get('/health', (c) => c.json({ status: 'ok', bot: 'riz-habit-bot' }));

// LINE Webhook
app.post('/webhook', webhook);

// Portal API（LIFF経由のフロントエンド用）
app.route('/portal', portalApi);

// === 河了貂（秘書）用サマリーAPI ===
// 全ユーザーの習慣進捗・プロファイル・メモ・会話ログ・傾向を一括返却
app.get('/api/summary', async (c) => {
  const supabase = getSupabase(c.env);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { data: users } = await supabase.from('users').select('*');
  if (!users || users.length === 0) return c.json({ users: [] });

  const summaries = await Promise.all(users.map(async (user) => {
    const [
      { data: profile },
      { data: habits },
      { data: todayRecs },
      { data: weekRecs },
      { data: notes },
      { data: stages },
      { data: recentChats },
    ] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('habits').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order'),
      supabase.from('habit_records').select('*').eq('user_id', user.id).eq('date', today),
      supabase.from('habit_records').select('*').eq('user_id', user.id).gte('date', weekAgo),
      supabase.from('user_notes').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(30),
      supabase.from('habit_stages').select('*').eq('user_id', user.id),
      supabase.from('unified_conversations').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);

    const todayMap = new Map((todayRecs ?? []).map((r: any) => [r.habit_id, r.status]));

    // 日別達成サマリー（直近7日）
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
    }
    const dailySummary = days.map(d => {
      const dayRecs = (weekRecs ?? []).filter((r: any) => r.date === d);
      const achieved = dayRecs.filter((r: any) => r.status === 'achieved').length;
      const minimum = dayRecs.filter((r: any) => r.status === 'minimum').length;
      return { date: d, achieved, minimum, total: achieved + minimum };
    });

    return {
      user: {
        id: user.id,
        display_name: user.display_name,
        onboarding_completed: user.onboarding_completed,
        created_at: user.created_at,
      },
      profile: profile ? {
        nickname: profile.nickname,
        type_code: profile.type_code,
        motivation_type: profile.motivation_type,
        failure_type: profile.failure_type,
        recovery_type: profile.recovery_type,
        coach_style: profile.coach_style,
        coach_tone: profile.coach_tone,
        life_rhythm: profile.life_rhythm,
        level: profile.level,
        total_xp: profile.total_xp,
      } : null,
      habits: (habits ?? []).map((h: any) => ({
        name: h.name,
        current_streak: h.current_streak,
        max_streak: h.max_streak,
        created_at: h.created_at,
        today_status: todayMap.get(h.id) ?? 'not_recorded',
        week_achieved: (weekRecs ?? []).filter((r: any) => r.habit_id === h.id && (r.status === 'achieved' || r.status === 'minimum')).length,
        achievement_line: h.achievement_line,
        minimum_line: h.minimum_line,
        anchor_habit: h.anchor_habit,
        stage: (stages ?? []).find((s: any) => s.habit_id === h.id)?.current_stage ?? 'unknown',
      })),
      daily_summary: dailySummary,
      notes: (notes ?? []).map((n: any) => ({ category: n.category, content: n.content })),
      recent_conversations: ((recentChats ?? []) as any[]).reverse().map((m: any) => ({
        channel: m.channel,
        role: m.role,
        content: m.content,
        at: m.created_at,
      })),
      today,
    };
  }));

  return c.json({ users: summaries, fetched_at: new Date().toISOString() });
});

// 手動トリガー（テスト用）
app.post('/api/trigger/morning', async (c) => {
  await morningPush(c.env);
  return c.json({ status: 'ok', type: 'morning' });
});

app.post('/api/trigger/evening', async (c) => {
  await eveningPush(c.env);
  return c.json({ status: 'ok', type: 'evening' });
});

// リッチメニュー作成（画像はPOSTボディで受け取る）
app.post('/api/setup-richmenu', async (c) => {
  const token = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  const LINE_API = 'https://api.line.me/v2/bot';
  const PORTAL_URL = 'https://imagawadaigo.github.io/habit-tracker/portal/';

  // 1. 既存リッチメニュー全削除
  try {
    const listRes = await fetch(`${LINE_API}/richmenu/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (listRes.ok) {
      const listData = await listRes.json() as { richmenus?: Array<{ richMenuId: string }> };
      for (const menu of listData.richmenus ?? []) {
        await fetch(`${LINE_API}/richmenu/${menu.richMenuId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
  } catch {}

  // 2. リッチメニュー作成
  const createRes = await fetch(`${LINE_API}/richmenu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'リズ メインメニュー',
      chatBarText: 'メニュー',
      areas: [
        { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=menu_record', displayText: '今日の記録' } },
        { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: 'postback', data: 'action=menu_list', displayText: '習慣一覧' } },
        { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=menu_settings', displayText: '設定' } },
        { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'uri', uri: `${PORTAL_URL}#logs` } },
        { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'uri', uri: `${PORTAL_URL}#tracker` } },
        { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'postback', data: 'action=menu_help', displayText: 'ヘルプ' } },
      ],
    }),
  });

  if (!createRes.ok) {
    return c.json({ error: 'create failed', detail: await createRes.text() }, 500);
  }
  const { richMenuId } = await createRes.json() as { richMenuId: string };

  // 3. 画像アップロード（リクエストボディからPNGを受け取る）
  const imageBody = await c.req.arrayBuffer();
  if (imageBody.byteLength > 0) {
    const uploadRes = await fetch(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          Authorization: `Bearer ${token}`,
        },
        body: imageBody,
      }
    );
    if (!uploadRes.ok) {
      return c.json({ error: 'upload failed', detail: await uploadRes.text(), richMenuId }, 500);
    }

    // 4. デフォルト設定
    const setRes = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!setRes.ok) {
      return c.json({ error: 'set default failed', detail: await setRes.text(), richMenuId }, 500);
    }

    return c.json({ status: 'ok', richMenuId, message: 'リッチメニュー作成・画像アップロード・デフォルト設定完了' });
  }

  return c.json({ status: 'created_no_image', richMenuId, message: '画像なし。手動アップロードが必要' });
});

export default {
  fetch: app.fetch,

  // Cron Trigger: 毎時0分に実行し、ユーザーごとの設定時刻と照合
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(morningPush(env));
    ctx.waitUntil(eveningPush(env));
  },
};
