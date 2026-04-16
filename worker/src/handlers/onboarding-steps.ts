import type { UserProfile } from '../types';

// =============================================
// Step 2: Q1 動機の源泉（1問目）
// =============================================
export function onboardingQ1(): Record<string, unknown> {
  return questionBubble(
    'Step 2/8',
    '動機の源泉 (1/2)',
    '「毎日30分運動する」と自分で決めました。\n2週間後、あなたの状態に一番近いのは？',
    [
      { label: '決めたから続けている', data: 'action=profiling_q1&value=A' },
      { label: '効果を調べて納得したから', data: 'action=profiling_q1&value=B' },
      { label: '予約や約束があるから', data: 'action=profiling_q1&value=C' },
      { label: '気分が乗る日だけ', data: 'action=profiling_q1&value=D' },
    ]
  );
}

// =============================================
// Step 3: Q2 動機の源泉（2問目）
// =============================================
export function onboardingQ2(): Record<string, unknown> {
  return questionBubble(
    'Step 3/8',
    '動機の源泉 (2/2)',
    '上司から「資格を取れ」と言われました。\n自分でもやや興味はあります。あなたの反応は？',
    [
      { label: '言われなくても取るつもりだった', data: 'action=profiling_q2&value=A' },
      { label: '本当に必要か調べてから決める', data: 'action=profiling_q2&value=B' },
      { label: '上司に言われたなら頑張る', data: 'action=profiling_q2&value=C' },
      { label: '「取れ」と言われると逆に...', data: 'action=profiling_q2&value=D' },
    ]
  );
}

// =============================================
// Step 4: Q3 挫折の構造（1問目）
// =============================================
export function onboardingQ3(): Record<string, unknown> {
  return questionBubble(
    'Step 4/8',
    '挫折の構造 (1/2)',
    '続けようとして続かなかったこと。\n一番の原因に近いのは？',
    [
      { label: '飽きて他のことに目移り', data: 'action=profiling_q3&value=A' },
      { label: '忙しくて時間がなくなった', data: 'action=profiling_q3&value=B' },
      { label: '気づいたら忘れていた', data: 'action=profiling_q3&value=C' },
      { label: 'ちゃんとできない日が嫌に', data: 'action=profiling_q3&value=D' },
    ]
  );
}

// =============================================
// Step 5: Q4 挫折の構造（2問目）
// =============================================
export function onboardingQ4(): Record<string, unknown> {
  return questionBubble(
    'Step 5/8',
    '挫折の構造 (2/2)',
    '新しい習慣を始めて1週間。今日はやる気が出ません。\n一番近い心境は？',
    [
      { label: '正直もう別のことがやりたい', data: 'action=profiling_q4&value=A' },
      { label: '今日は本当に時間がない', data: 'action=profiling_q4&value=B' },
      { label: 'あ、まだやってなかった', data: 'action=profiling_q4&value=C' },
      { label: '中途半端ならやらない方がマシ', data: 'action=profiling_q4&value=D' },
    ]
  );
}

// =============================================
// Step 6: Q5 回復の型（1問目）
// =============================================
export function onboardingQ5(): Record<string, unknown> {
  return questionBubble(
    'Step 6/8',
    '回復の型 (1/2)',
    '3日間サボってしまいました。\n一番立ち直りやすいのは？',
    [
      { label: '「もう一度やる」と宣言し直す', data: 'action=profiling_q5&value=A' },
      { label: '原因を分析して仕組みを修正', data: 'action=profiling_q5&value=B' },
      { label: '誰かに「また始める」と報告', data: 'action=profiling_q5&value=C' },
      { label: '小さいことから再開する', data: 'action=profiling_q5&value=D' },
    ]
  );
}

// =============================================
// Step 7: Q6 回復の型（2問目）
// =============================================
export function onboardingQ6(): Record<string, unknown> {
  return questionBubble(
    'Step 7/8',
    '回復の型 (2/2)',
    '習慣を立て直すとき、一番助けになるのは？',
    [
      { label: '再スタート日を決めること', data: 'action=profiling_q6&value=A' },
      { label: '原因を特定して対策を立てる', data: 'action=profiling_q6&value=B' },
      { label: '一緒にやる人がいること', data: 'action=profiling_q6&value=C' },
      { label: 'ハードルを下げてとにかく1回', data: 'action=profiling_q6&value=D' },
    ]
  );
}

// =============================================
// Step 8: プロファイル結果 + 関わり方確認
// =============================================
export function onboardingResult(profile: {
  motivationLabel: string;
  motivationDesc: string;
  failureLabel: string;
  failureDesc: string;
  recoveryLabel: string;
  recoveryDesc: string;
  recommendedStyle: string;
}): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'あなたの習慣化プロファイル', size: 'md', weight: 'bold', color: '#FF8A65' },
      ],
      paddingAll: 'lg',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'lg',
      contents: [
        profileSection('動機', profile.motivationLabel, profile.motivationDesc),
        separator(),
        profileSection('挫折', profile.failureLabel, profile.failureDesc),
        separator(),
        profileSection('回復', profile.recoveryLabel, profile.recoveryDesc),
        separator(),
        {
          type: 'text',
          text: `おすすめの関わり方: ${profile.recommendedStyle}`,
          size: 'sm',
          weight: 'bold',
          margin: 'md',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          margin: 'md',
          contents: [
            makeButton('この関わり方でOK', `action=onboarding_style_confirm&value=auto`, '#FF8A65'),
            makeButton('もっと優しく', `action=onboarding_style_confirm&value=gentle`, '#FFAB91'),
            makeButton('もっと厳しく', `action=onboarding_style_confirm&value=strict`, '#E64A19'),
          ],
        },
      ],
      paddingAll: 'lg',
    },
  };
}

// =============================================
// Step 9: 話し方選択（変更なし）
// =============================================
export function onboardingToneSelect(): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'Step 8/8', size: 'xs', color: '#FF8A65', weight: 'bold' },
        { type: 'text', text: 'コーチの話し方を選んでください', size: 'md', weight: 'bold', margin: 'sm' },
      ],
      paddingAll: 'lg',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        toneOption('丁寧', 'です/ます調。穏やかで安心感', '「今日もお疲れさまです。記録をつけましょう」', 'action=onboarding_tone&value=polite'),
        toneOption('フランク', 'だよ/だね。友達感覚', '「今日どうだった？できたこと教えてよ」', 'action=onboarding_tone&value=frank'),
        toneOption('兄貴/姉御', 'だ/だろ/しろ。体育会的な熱さ', '「今日やったか？やったなら報告しろ」', 'action=onboarding_tone&value=aniki'),
        toneOption('淡々', 'ください/します。事務的トーン', '「本日の記録を入力してください」', 'action=onboarding_tone&value=neutral'),
      ],
      paddingAll: 'lg',
    },
  };
}

// =============================================
// 生活リズム選択
// =============================================
export function onboardingRhythm(): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'あと少し!', size: 'xs', color: '#FF8A65', weight: 'bold' },
        { type: 'text', text: '生活リズムを教えてください', size: 'md', weight: 'bold', margin: 'sm' },
      ],
      paddingAll: 'lg',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        makeButton('朝型', 'action=onboarding_rhythm&value=morning', '#FF8A65'),
        makeButton('夜型', 'action=onboarding_rhythm&value=night', '#FF8A65'),
        makeButton('不規則', 'action=onboarding_rhythm&value=irregular', '#FF8A65'),
      ],
      paddingAll: 'lg',
    },
  };
}

// =============================================
// プロファイル完了サマリー
// =============================================
export function onboardingComplete(profile: Record<string, unknown> | null): Record<string, unknown> {
  const p = profile as UserProfile | null;
  const rhythmLabel: Record<string, string> = { morning: '朝型', night: '夜型', irregular: '不規則' };
  const styleLabel: Record<string, string> = { gentle: '優しめ', balanced: 'バランス', strict: '厳しめ' };
  const toneLabel: Record<string, string> = { polite: '丁寧', frank: 'フランク', aniki: '兄貴/姉御', tough: '兄貴/姉御', neutral: '淡々' };
  const mLabel: Record<string, string> = { M1: '自律駆動型', M2: '納得駆動型', M3: '他者駆動型', M4: '自由駆動型' };
  const fLabel: Record<string, string> = { F1: '動機減衰型', F2: '能力不足型', F3: 'きっかけ欠如型', F4: '基準過剰型' };
  const rLabel: Record<string, string> = { R1: '宣言リセット型', R2: '分析改善型', R3: '外部再接続型', R4: '最小行動型' };

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '設定完了', size: 'md', weight: 'bold', color: '#FF8A65' },
      ],
      paddingAll: 'lg',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        infoRow('ニックネーム', p?.nickname ?? '未設定'),
        infoRow('タイプ', p?.type_code ?? '未判定'),
        infoRow('動機', mLabel[p?.motivation_type ?? ''] ?? '未判定'),
        infoRow('挫折', fLabel[p?.failure_type ?? ''] ?? '未判定'),
        infoRow('回復', rLabel[p?.recovery_type ?? ''] ?? '未判定'),
        infoRow('関わり方', styleLabel[p?.coach_style ?? ''] ?? '未設定'),
        infoRow('話し方', toneLabel[p?.coach_tone ?? ''] ?? '未設定'),
        infoRow('生活リズム', rhythmLabel[p?.life_rhythm ?? ''] ?? '未設定'),
      ],
      paddingAll: 'lg',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '「リセット」で再設定できます', size: 'xs', color: '#999999', align: 'center' },
      ],
      paddingAll: 'md',
    },
  };
}

// =============================================
// 64類型の判定ロジック
// =============================================
export function determineType(q1: string, q2: string): { primary: string; secondary: string | null } {
  const map: Record<string, string> = { A: '1', B: '2', C: '3', D: '4' };
  if (q1 === q2) return { primary: map[q1], secondary: null };

  // 不一致: q1をプライマリ、q2をセカンダリ
  return { primary: map[q1], secondary: map[q2] };
}

export function recommendStyle(mType: string, fType: string, rType: string): 'gentle' | 'balanced' | 'strict' {
  // M1/M4 → 優しめ（干渉不要/圧をかけない）
  // M2/M3 → バランス
  let style: 'gentle' | 'balanced' | 'strict' = 'balanced';

  if (mType === 'M1' || mType === 'M4') style = 'gentle';
  if (mType === 'M3') style = 'balanced';

  // R3（外部再接続）→ しっかり寄り
  if (rType === 'R3' && style !== 'gentle') style = 'strict';

  // F4（基準過剰）→ 厳しめは非推奨
  if (fType === 'F4' && style === 'strict') style = 'balanced';

  return style;
}

export const MOTIVATION_LABELS: Record<string, { label: string; desc: string }> = {
  M1: { label: '自律駆動型', desc: '自分で決めたことを自分で守れる' },
  M2: { label: '納得駆動型', desc: '理由と根拠があれば動ける' },
  M3: { label: '他者駆動型', desc: '誰かの存在が力になる' },
  M4: { label: '自由駆動型', desc: '自分の選択として動きたい' },
};

export const FAILURE_LABELS: Record<string, { label: string; desc: string }> = {
  F1: { label: '動機減衰型', desc: '新鮮さが切れると止まりやすい' },
  F2: { label: '能力不足型', desc: '時間や余裕がないと止まりやすい' },
  F3: { label: 'きっかけ欠如型', desc: '思い出せれば動ける' },
  F4: { label: '基準過剰型', desc: '完璧にできないと嫌になる' },
};

export const RECOVERY_LABELS: Record<string, { label: string; desc: string }> = {
  R1: { label: '宣言リセット型', desc: '決め直すことで再起動する' },
  R2: { label: '分析改善型', desc: '原因を理解して仕組みを直す' },
  R3: { label: '外部再接続型', desc: '誰かとの接続で再開する' },
  R4: { label: '最小行動型', desc: '小さく再開するのが得意' },
};

// =============================================
// Helpers
// =============================================

function questionBubble(
  stepLabel: string,
  title: string,
  question: string,
  options: Array<{ label: string; data: string }>
): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: stepLabel, size: 'xs', color: '#FF8A65', weight: 'bold' },
        { type: 'text', text: title, size: 'md', weight: 'bold', margin: 'sm' },
      ],
      paddingAll: 'lg',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: question, size: 'sm', wrap: true, color: '#333333' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          margin: 'lg',
          contents: options.map((opt) => makeButton(opt.label, opt.data, '#FF8A65')),
        },
      ],
      paddingAll: 'lg',
    },
  };
}

function profileSection(category: string, label: string, desc: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents: [
      { type: 'text', text: category, size: 'xs', color: '#FF8A65', weight: 'bold' },
      { type: 'text', text: label, size: 'sm', weight: 'bold' },
      { type: 'text', text: desc, size: 'xs', color: '#666666', wrap: true },
    ],
  };
}

function separator(): Record<string, unknown> {
  return { type: 'separator', color: '#EEEEEE' };
}

function makeButton(label: string, postbackData: string, color: string): Record<string, unknown> {
  return {
    type: 'button',
    action: { type: 'postback', label, data: postbackData, displayText: label },
    style: 'primary',
    color,
    height: 'sm',
  };
}

function toneOption(title: string, desc: string, example: string, postbackData: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents: [
      { type: 'text', text: title, size: 'sm', weight: 'bold' },
      { type: 'text', text: desc, size: 'xs', color: '#666666', wrap: true },
      { type: 'text', text: example, size: 'xs', color: '#999999', wrap: true },
      {
        type: 'button',
        action: { type: 'postback', label: `${title}を選ぶ`, data: postbackData, displayText: title },
        style: 'primary',
        color: '#FF8A65',
        height: 'sm',
        margin: 'sm',
      },
    ],
    paddingAll: 'sm',
    borderWidth: 'light',
    borderColor: '#EEEEEE',
    cornerRadius: 'md',
  };
}

function infoRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#999999', flex: 2 },
      { type: 'text', text: value, size: 'sm', weight: 'bold', flex: 3 },
    ],
  };
}
