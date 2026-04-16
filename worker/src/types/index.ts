// === Env ===
export type Env = {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ENVIRONMENT: string;
};

// === DB Types ===

export interface User {
  id: string;
  line_user_id: string;
  display_name: string | null;
  coach_phase: 'early' | 'mid' | 'established';
  onboarding_completed: boolean;
  created_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  nickname: string | null;
  life_rhythm: 'morning' | 'night' | 'irregular' | null;

  // 64類型プロファイリング
  motivation_type: string | null; // M1-M4
  motivation_secondary: string | null;
  motivation_q1: string | null;
  motivation_q2: string | null;
  failure_type: string | null; // F1-F4
  failure_secondary: string | null;
  failure_q3: string | null;
  failure_q4: string | null;
  recovery_type: string | null; // R1-R4
  recovery_secondary: string | null;
  recovery_q5: string | null;
  recovery_q6: string | null;
  type_code: string | null; // M?-F?-R?

  // レガシー（互換用）
  tendency_type: string | null;
  tendency_secondary: string | null;
  tendency_raw_answers: Record<string, string> | null;
  failure_patterns: string[];

  // コーチ設定
  coach_style: 'gentle' | 'balanced' | 'strict';
  coach_style_auto: string | null;
  coach_tone: 'polite' | 'frank' | 'aniki' | 'tough' | 'neutral';
  reminder_frequency: 'minimal' | 'normal' | 'full';
  morning_notify_time: string;
  evening_notify_time: string;
  success_experience: string | null;
  onboarding_step: number;
  total_xp: number;
  level: number;
  pending_action: string | null;
  created_at: string;
  updated_at: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  category: 'action' | 'lifestyle';
  achievement_line: string | null;
  minimum_line: string | null;
  anchor_habit: string | null;
  sort_order: number;
  is_active: boolean;
  current_streak: number;
  max_streak: number;
  created_at: string;
}

export interface DailyLog {
  id: string;
  user_id: string;
  date: string;
  focus: string | null;
  highlight: string | null;
  kpt_keep: string | null;
  kpt_problem: string | null;
  kpt_try: string | null;
  created_at: string;
}

export interface HabitRecord {
  id: string;
  user_id: string;
  habit_id: string;
  date: string;
  status: 'achieved' | 'minimum' | 'missed';
  created_at: string;
}

export interface UserNote {
  id: string;
  user_id: string;
  category: 'preference' | 'lifestyle' | 'relationship' | 'interest' | 'habit_context' | 'other';
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface MonthlyGoal {
  id: string;
  user_id: string;
  year_month: string;
  goals: string[] | null;
  reflection: string | null;
  created_at: string;
}

export interface HabitStage {
  id: string;
  user_id: string;
  habit_id: string;
  current_stage: 'preparation' | 'execution_early' | 'execution_mid' | 'established';
  stage_entered_at: string;
  crisis_count: number;
  last_7day_rate: number | null;
  prev_7day_rate: number | null;
  updated_at: string;
}

// === LINE Webhook Types ===

export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

export interface LineEvent {
  type: 'message' | 'follow' | 'unfollow' | 'postback';
  message?: {
    type: 'text' | 'image' | 'sticker';
    id: string;
    text?: string;
  };
  postback?: {
    data: string;
  };
  timestamp: number;
  source: {
    type: 'user' | 'group' | 'room';
    userId: string;
  };
  replyToken: string;
}

// === LINE API Types ===

export interface LineTextMessage {
  type: 'text';
  text: string;
}

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

export type LineMessage = LineTextMessage | LineFlexMessage;
