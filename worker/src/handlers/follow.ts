import { SupabaseClient } from '@supabase/supabase-js';
import type { Env, User, UserProfile, LineEvent } from '../types';
import { replyMessage, textMessage, flexMessage } from '../lib/line';
import { upsertProfile } from '../lib/supabase';

export async function handleFollow(
  env: Env,
  supabase: SupabaseClient,
  user: User,
  event: LineEvent
) {
  await upsertProfile(supabase, user.id, {
    onboarding_step: 1,
    coach_style: 'balanced',
    coach_tone: 'polite',
    reminder_frequency: 'normal',
    morning_notify_time: '08:00',
    evening_notify_time: '22:00',
    failure_patterns: [],
  } as Partial<UserProfile>);

  await replyMessage(env, event.replyToken, [
    textMessage(
      'はじめまして。リズです。\nあなたの習慣づくりを一緒に進めるコーチです。\n\n8つのステップであなたに合った関わり方を設計します。\n約3分で終わります。\n\nまず、ニックネームを教えてください。'
    ),
  ]);
}
