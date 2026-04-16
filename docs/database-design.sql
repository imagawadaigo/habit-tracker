-- =============================================
-- リズ（習慣管理LINE Bot）テーブル設計
-- Alexa AIアシスタントと同一Supabaseプロジェクトを共有
-- =============================================

-- users テーブル（Alexa側と共有。既存なら ALTER のみ）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT UNIQUE,
  alexa_user_id TEXT UNIQUE,
  display_name TEXT,
  coach_phase TEXT NOT NULL DEFAULT 'early' CHECK (coach_phase IN ('early', 'mid', 'established')),
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_profiles テーブル
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  nickname TEXT,
  life_rhythm TEXT CHECK (life_rhythm IN ('morning', 'night', 'irregular')),
  tendency_type TEXT CHECK (tendency_type IN ('upholder', 'questioner', 'obliger', 'rebel', 'mixed')),
  tendency_secondary TEXT,
  tendency_raw_answers JSONB,
  failure_patterns TEXT[] DEFAULT '{}',
  coach_style TEXT NOT NULL DEFAULT 'balanced' CHECK (coach_style IN ('gentle', 'balanced', 'strict')),
  coach_tone TEXT NOT NULL DEFAULT 'polite' CHECK (coach_tone IN ('polite', 'frank', 'tough', 'neutral')),
  reminder_frequency TEXT NOT NULL DEFAULT 'normal' CHECK (reminder_frequency IN ('minimal', 'normal', 'full')),
  morning_notify_time TIME DEFAULT '08:00',
  evening_notify_time TIME DEFAULT '22:00',
  success_experience TEXT,
  onboarding_step INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- habits テーブル
CREATE TABLE habits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'action' CHECK (category IN ('action', 'lifestyle')),
  achievement_line TEXT,
  minimum_line TEXT,
  sort_order INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- daily_logs テーブル
CREATE TABLE daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  focus TEXT,
  highlight TEXT,
  kpt_keep TEXT,
  kpt_problem TEXT,
  kpt_try TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- habit_records テーブル
CREATE TABLE habit_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('achieved', 'minimum', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, habit_id, date)
);

-- monthly_goals テーブル
CREATE TABLE monthly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  year_month TEXT NOT NULL, -- 'YYYY-MM'
  goals JSONB,
  reflection TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, year_month)
);

-- habit_stages テーブル（行動変容ステージ管理）
CREATE TABLE habit_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'preparation' CHECK (current_stage IN (
    'preparation', 'execution_early', 'execution_mid', 'established'
  )),
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  crisis_count INT NOT NULL DEFAULT 0,
  last_7day_rate DECIMAL(5,2),
  prev_7day_rate DECIMAL(5,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, habit_id)
);

-- reminder_logs テーブル
CREATE TABLE reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  reminder_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- お金管理テーブル（MyPortal用）
-- =============================================

-- financial_records テーブル（手動入力 + CSV取り込み）
CREATE TABLE financial_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  category TEXT NOT NULL, -- '収入', '支出', '投資' etc.
  subcategory TEXT, -- 'PayPay', 'GCDデビット', 'freee', '手入力' etc.
  description TEXT NOT NULL,
  amount INT NOT NULL, -- 正=収入, 負=支出
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv_paypay', 'csv_card', 'freee_api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_records_user_date ON financial_records(user_id, date);

-- =============================================
-- RLS（Row Level Security）
-- =============================================
-- LINE Bot / Alexa はすべて Cloudflare Worker 経由の Service Role でアクセス。
-- MyPortal は Supabase Auth + RLS で保護する場合に以下を有効化。

-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE habit_records ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE habit_stages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE financial_records ENABLE ROW LEVEL SECURITY;
