import type { Env, LineMessage, LineWebhookBody } from '../types';

const LINE_API_BASE = 'https://api.line.me/v2/bot';

export async function replyMessage(
  env: Env,
  replyToken: string,
  messages: LineMessage[]
): Promise<void> {
  const res = await fetch(`${LINE_API_BASE}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${body}`);
  }
}

export async function pushMessage(
  env: Env,
  to: string,
  messages: LineMessage[]
): Promise<void> {
  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed: ${res.status} ${body}`);
  }
}

// LINE Webhook署名検証
export async function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

// テキストメッセージのヘルパー
export function textMessage(text: string): LineMessage {
  return { type: 'text', text };
}

// Flex Messageのヘルパー
export function flexMessage(altText: string, contents: Record<string, unknown>): LineMessage {
  return { type: 'flex', altText, contents };
}
