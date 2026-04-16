import { Hono } from 'hono';
import type { Env } from './types';
import { webhook } from './routes/webhook';
import { portalApi } from './routes/portal-api';
import { morningPush, eveningPush } from './handlers/cron';

const app = new Hono<{ Bindings: Env }>();

// ヘルスチェック
app.get('/health', (c) => c.json({ status: 'ok', bot: 'riz-habit-bot' }));

// LINE Webhook
app.post('/webhook', webhook);

// Portal API（LIFF経由のフロントエンド用）
app.route('/portal', portalApi);

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
  const PORTAL_URL = 'https://bkdj5.github.io/habit-tracker/portal/';

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
