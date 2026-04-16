import { Context } from 'hono';
import type { Env, LineEvent } from '../types';
import { verifySignature } from '../lib/line';
import { getSupabase, getOrCreateUser, getProfile } from '../lib/supabase';
import { handleFollow } from '../handlers/follow';
import { handleTextMessage } from '../handlers/message';
import { handlePostback } from '../handlers/postback';

export async function webhook(c: Context<{ Bindings: Env }>) {
  const body = await c.req.text();
  const signature = c.req.header('x-line-signature');

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  const valid = await verifySignature(body, signature, c.env.LINE_CHANNEL_SECRET);
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const parsed = JSON.parse(body) as { events: LineEvent[] };

  // 非同期でイベントを処理（LINEには即座に200を返す）
  c.executionCtx.waitUntil(
    processEvents(c.env, parsed.events)
  );

  return c.json({ status: 'ok' });
}

async function processEvents(env: Env, events: LineEvent[]) {
  const supabase = getSupabase(env);

  for (const event of events) {
    try {
      const lineUserId = event.source.userId;
      const user = await getOrCreateUser(supabase, lineUserId);
      const profile = await getProfile(supabase, user.id);

      switch (event.type) {
        case 'follow':
          await handleFollow(env, supabase, user, event);
          break;
        case 'message':
          if (event.message?.type === 'text' && event.message.text) {
            await handleTextMessage(env, supabase, user, profile, event);
          }
          break;
        case 'postback':
          if (event.postback) {
            await handlePostback(env, supabase, user, profile, event);
          }
          break;
      }
    } catch (err) {
      console.error('Event processing error:', err);
    }
  }
}
