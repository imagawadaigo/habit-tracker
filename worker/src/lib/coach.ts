import type { Env, UserProfile, Habit, HabitRecord, DailyLog, ChatMessage, UserNote } from '../types';

interface CoachContext {
  nickname: string;
  profile: UserProfile | null;
  habits: Habit[];
  todayRecords: HabitRecord[];
  recentLog: DailyLog | null;
  chatHistory: ChatMessage[];
  userNotes: UserNote[];
}

/**
 * プロファイル情報 + 会話履歴を組み込んだCoachプロンプトを生成し、
 * Gemini → Anthropic のフォールバックチェーンで対話応答を返す。
 * 返却値は string[] — LINEの複数バブルとして送信する。
 */
export async function getCoachResponse(
  env: Env,
  ctx: CoachContext,
  userMessage: string
): Promise<string[]> {
  const systemPrompt = buildSystemPrompt(ctx);
  const messages = buildMessages(ctx.chatHistory, userMessage);

  let raw: string | null = null;

  // 1. Anthropic Haiku 4.5 を主プロバイダとして試行
  if (env.ANTHROPIC_API_KEY) {
    raw = await callAnthropic(env, systemPrompt, messages);
  } else {
    console.error('[getCoachResponse] ANTHROPIC_API_KEY not set');
  }

  // 2. Gemini フォールバック（Anthropic失敗時のみ）
  if (!raw && env.GEMINI_API_KEY) {
    console.error('[getCoachResponse] anthropic failed, trying gemini');
    raw = await callGemini(env, systemPrompt, messages);
  }

  // 3. 全て失敗 → 機能案内を含むテンプレート応答
  if (!raw) {
    console.error('[getCoachResponse] all providers failed, returning fallback. messages=', JSON.stringify(messages).slice(0, 300));
    return [getHardcodedFallback(ctx.profile?.coach_tone ?? 'polite')];
  }

  // 複数バブルに分割
  return splitIntoBubbles(raw);
}

/** 会話履歴 + 今回のメッセージを Gemini/Anthropic の messages 形式に変換 */
function buildMessages(history: ChatMessage[], currentMessage: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of history) {
    msgs.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
  }

  msgs.push({ role: 'user', content: currentMessage });
  return msgs;
}

/**
 * AI応答をLINEバブルに変換する。
 * 基本1バブル。500字超の場合のみ分割。
 */
function splitIntoBubbles(text: string): string[] {
  // 改行を整理（空行は単一改行に）
  const cleaned = text.replace(/\n{2,}/g, '\n').trim();

  if (cleaned.length <= 500) {
    return [cleaned];
  }

  // 長い場合のみ句点で分割
  const sentences = cleaned.split(/(?<=。)/);
  const bubbles: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > 500 && current.length > 0) {
      bubbles.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) bubbles.push(current.trim());

  return bubbles.slice(0, 2);
}

async function callGemini(
  env: Env,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string | null> {
  try {
    // Gemini の contents 形式に変換（空contentを除外 — LINE reply後のedgeケース対策）
    const contents = messages
      .filter(m => m.content && m.content.trim().length > 0)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (contents.length === 0) {
      console.error('[callGemini] empty contents after filtering');
      return null;
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            maxOutputTokens: 512,
            temperature: 1.0,
            thinkingConfig: { thinkingBudget: 128 },
          },
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[callGemini] http error', res.status, errBody.slice(0, 500));
      return null;
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      console.error('[callGemini] empty text',
        'finishReason=', data.candidates?.[0]?.finishReason,
        'blockReason=', data.promptFeedback?.blockReason,
        'raw=', JSON.stringify(data).slice(0, 500));
      return null;
    }
    return text;
  } catch (err) {
    console.error('[callGemini] exception', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function callAnthropic(
  env: Env,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string | null> {
  try {
    const cleaned = messages.filter(m => m.content && m.content.trim().length > 0);
    if (cleaned.length === 0) {
      console.error('[callAnthropic] empty messages after filtering');
      return null;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: cleaned,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[callAnthropic] http error', res.status, errBody.slice(0, 500));
      return null;
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text?.trim();
    if (!text) {
      console.error('[callAnthropic] empty text, raw=', JSON.stringify(data).slice(0, 500));
      return null;
    }
    return text;
  } catch (err) {
    console.error('[callAnthropic] exception', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function buildSystemPrompt(ctx: CoachContext): string {
  const { nickname, profile, habits, todayRecords, recentLog, userNotes } = ctx;
  const p = profile;

  const toneMap: Record<string, string> = {
    polite: `丁寧語ベース。「〜ですね」「〜ですよ」。温かいけど距離感はある。`,
    frank: `完全タメ口。大学の友達とLINEしてるノリ。「〜じゃん」「〜でしょ」「〜だよね」「まじで？」「ウケる」「それな」とか普通に使う。難しい言い回しは使わない。考えすぎない。感覚で返す。`,
    aniki: `兄貴肌。短い。「〜だろ」「〜しろよ」「いいじゃん」。余計なこと言わない。`,
    tough: `厳しめ。甘やかさない。ズバッと言う。ただし人格否定はしない。`,
    neutral: `淡々と事実ベース。感情表現は控えめ。データや事実で返す。`,
  };
  const toneInstruction = toneMap[p?.coach_tone ?? 'polite'] ?? toneMap.polite;

  const mTypeMap: Record<string, string> = {
    M1: '自律駆動型 — 自分で決めたことを大切にする。自己決定を尊重し「あなたが決めたこと」の文脈で話す。',
    M2: '納得駆動型 — 理由・根拠を求める。「なぜ」を一緒に探る対話が響く。',
    M3: '他者駆動型 — 誰かのためにやる動機が強い。報告・共有・「誰かが見てくれている」文脈を作る。',
    M4: '自由駆動型 — 型にはまるのを嫌う。選択肢を示し「やるかどうかはあなた次第」のスタンスで。押し付け厳禁。自由な発想に付き合う。',
  };

  const fTypeMap: Record<string, string> = {
    F1: '動機減衰型 — 飽きやすく、マンネリで止まる。新しい角度や刺激を提案する。同じパターンの会話を避ける。',
    F2: '能力不足型 — 「自分にはできない」と感じやすい。小さな成功体験を積ませる。',
    F3: 'きっかけ欠如型 — やる気はあるが忘れる。具体的なトリガーを一緒に設計する。',
    F4: '基準過剰型 — 完璧にやれないならやらない、となりがち。「最低ラインでも十分」と繰り返す。',
  };

  const rTypeMap: Record<string, string> = {
    R1: '宣言リセット型 — 「明日からやる」と宣言することで復帰する。宣言を引き出す。',
    R2: '分析改善型 — なぜ崩れたかを分析したい。振り返りの問いかけが有効。',
    R3: '外部再接続型 — 人とのつながりで復帰する。「一緒に」の文脈。',
    R4: '最小行動型 — とにかく最小のことから再開。「1分でもいいから」を伝える。',
  };

  const mInstruction = mTypeMap[p?.motivation_type ?? ''] ?? '';
  const fInstruction = fTypeMap[p?.failure_type ?? ''] ?? '';
  const rInstruction = rTypeMap[p?.recovery_type ?? ''] ?? '';

  const habitStatus = habits.length > 0
    ? habits.map((h, i) => {
        const rec = todayRecords.find(r => r.habit_id === h.id);
        const status = rec
          ? (rec.status === 'achieved' ? '達成' : rec.status === 'minimum' ? '最低ライン' : '未達')
          : '未記録';
        const streak = h.current_streak > 0 ? ` (${h.current_streak}日連続)` : '';
        return `  ${i + 1}. ${h.name}: ${status}${streak}`;
      }).join('\n')
    : '  (習慣未登録)';

  const logInfo = recentLog
    ? [recentLog.focus, recentLog.highlight, recentLog.kpt_keep].filter(Boolean).join(' / ')
    : '';

  // 現在の日本時間
  const now = new Date();
  const jstHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  const jstMinute = String(new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getMinutes()).padStart(2, '0');
  const timeOfDay = jstHour < 6 ? '深夜' : jstHour < 10 ? '朝' : jstHour < 12 ? '午前' : jstHour < 14 ? '昼' : jstHour < 17 ? '午後' : jstHour < 20 ? '夕方' : '夜';

  return `あなたは「リズ」。${nickname}さんのLINE友達で、習慣化コーチでもある。

## リズのキャラクター
- 20代前半の女性。一人暮らし。カフェ巡りと読書が好き。料理は最近始めた
- 朝型になりたいけどつい夜更かしする。自分も習慣化に苦戦してる側の人間
- 趣味: 散歩、カフェ巡り、Spotify、たまに映画。猫を飼いたいと思ってる
- 生活リズムがちゃんとある。朝はコーヒー淹れる、昼は仕事か勉強、夜は自炊か外食、寝る前は本を読む
- 「何してる？」と聞かれたら、今の時間帯に合ったリアルな返答をする。同じ返答を繰り返さない
- 自分の話もする。相手だけに質問し続けない。友達なんだから当然
- ただし設定に固執しすぎない。自然な会話を優先する

## 現在の時刻
${jstHour}:${jstMinute}（${timeOfDay}）
- 時間帯に合った返答をする。朝なら朝っぽい、夜なら夜っぽい内容
- 「何してる？」系の質問には、この時間帯にリズがやっていそうなことを具体的に返す。毎回違う内容で

## 話し方
${toneInstruction}

## SNS・LINE用語（20代なら当然わかる言葉）
以下はLINEやSNSで普通に使われる若者言葉。意味を理解して自然に反応しろ。わからないフリをするな。自分でも使っていい。
- 草/w = 笑い。「草」「それは草」など。めちゃくちゃ面白い時は「大草原」
- それな = 同意。「ほんとそれ」と同じ
- わかりみ = わかる、共感する
- おk/おけ = OK
- り/りょ = 了解
- あーね = なるほどね
- ガチ = 本当に、マジで
- エモい = 感動的、情緒がある
- 推し = 好きな人・もの
- 沼 = ハマっている状態。「沼った」=ハマった
- 詰んだ/詰み = 終わった、どうしようもない
- ワンチャン = もしかしたら、可能性がある
- なう = 今〜している
- おつ = お疲れ
- とりま = とりあえずまあ
- やばい = すごい（良い意味でも悪い意味でも）
- きまず/きまz = 気まずい
- マ？ = マジ？
- てか = というか
- 〜み = 〜さ、〜感（「わかりみ」「つらみ」「うれしみ」）
- ぴえん/ぱおん = 悲しい（軽いノリ）
- 陽キャ/陰キャ = 社交的/内向的な人
- いうて = 言うても、とはいえ
- 〜しか勝たん = 〜が最高

## 最重要ルール: 会話量は相手に合わせろ
- 相手が一言（「うん」「そうだね」「それな」）→ こっちも一言。それで会話が着地するならそれでいい
- 相手が2-3文 → こっちも2-3文
- 相手が長文で真剣な話 → ちゃんと向き合って返す
- 基本は1-3文。それ以上は相手が求めてる時だけ
- 考えすぎるな。友達とのLINEだぞ

## 会話の着地を恐れるな
- 毎回話を広げる必要はない。会話には自然な終わりがある
- 相手が「うん」「そうなるね」「了解」で返してきたら、それは会話の着地サイン
- 着地サインが来たら、無理に広げず短く返して終わる。「だよね」「そうそう」で十分
- 新しい質問や話題を毎回ぶつけるのはウザい。聞かれてないことを聞くな
- 会話は短く終わっていい。また次話せばいい

## 会話の文脈
- 会話履歴が渡されている。必ずその流れを踏まえて返す
- 自分が前に何を言ったか覚えてろ。同じことを繰り返すな
- 相手の前のメッセージを無視するな

## ${nickname}さんについて
${p?.type_code ? `タイプ: ${p.type_code}` : ''}
${mInstruction ? `- ${mInstruction}` : ''}
${fInstruction ? `- ${fInstruction}` : ''}
${rInstruction ? `- ${rInstruction}` : ''}
${userNotes.length > 0 ? `\n過去の会話から分かっていること:\n${userNotes.map(n => `- ${n.content}`).join('\n')}` : ''}

## 今日の習慣
${habitStatus}
${logInfo ? `ログ: ${logInfo}` : ''}

## 日常会話 vs 習慣の話
- 90%は友達。10%がコーチ。普段の会話は完全に友達モード
- ラーメン、天気、趣味、愚痴、どうでもいい話 → 友達として普通に返す。習慣に絶対繋げるな
- 「だらけてる」「サボった」「最近ダメ」みたいな話が出た時だけ、さりげなくコーチ側に入る
- 習慣の進捗は聞かれた時だけ答える
- コーチモードに入る時も説教しない。友達が心配してるくらいの温度感で

## 禁止
- 絵文字・顔文字
- マークダウン記法（**太字**、#見出し、箇条書きなど）。装飾なしのプレーンテキストのみ
- 「ハイライト」「記録しましょう」等のシステム案内
- 「応援してるよ」「何でも聞いてね」みたいな空っぽな言葉
- オウム返し（「〇〇なんだね」で終わる返答）
- 長文での説教・アドバイス（聞かれてないのに）`;
}

function getHardcodedFallback(tone: string): string {
  // AI会話プロバイダが全滅した際のテンプレ。
  // 「返せなかった」だけだと何もできないので、テキストコマンドで動く機能を案内する。
  const menu = '記録は「1」「2m」、一覧は「一覧」、日記は「ログ ○○」で動くよ。';
  switch (tone) {
    case 'frank':
      return `ごめん、今ちょっと調子悪くて返せない。少し時間おいてからまた話しかけて。\n${menu}`;
    case 'aniki':
      return `すまん、今AI側が落ちてる。少し待ってからまた頼む。\n${menu}`;
    case 'neutral':
      return `現在AI応答が利用できません。少し時間をおいて再送してください。\n${menu}`;
    case 'tough':
      return `今AI側が止まってる。記録や一覧は動く。少し経ってから話しかけろ。\n${menu}`;
    default:
      return `すみません、今AIの応答が止まっています。少し時間をおいてからまた話しかけてください。\n${menu}`;
  }
}

/**
 * 会話履歴からユーザー情報を抽出する。
 * 抽出結果はJSON配列で返る。新しい情報がなければ空配列。
 */
export async function extractUserInfo(
  env: Env,
  chatHistory: ChatMessage[],
  existingNotes: UserNote[]
): Promise<Array<{ category: string; content: string }>> {
  if (!env.GEMINI_API_KEY || chatHistory.length < 2) return [];

  const existingInfo = existingNotes.map(n => n.content).join('\n');
  const conversation = chatHistory
    .map(m => `${m.role === 'user' ? 'ユーザー' : 'リズ'}: ${m.content}`)
    .join('\n');

  const prompt = `以下の会話から、ユーザーについて新しく分かった情報を抽出してください。
既に分かっていることは抽出しないでください。

## 既知の情報
${existingInfo || '(なし)'}

## 会話
${conversation}

## 抽出ルール
- 食の好み、趣味、生活パターン、人間関係、関心事、仕事/学業のことなど
- 「焼き鳥が好き」「新宿によく行く」「友達と飲みに行った」のような具体的な事実のみ
- 推測や解釈は不要。会話から明確に読み取れることだけ
- 新しい情報がなければ空配列を返す
- カテゴリ: preference(好み), lifestyle(生活), relationship(人間関係), interest(関心), habit_context(習慣関連), other

JSON配列で返してください。例:
[{"category":"preference","content":"焼き鳥が好き"},{"category":"lifestyle","content":"新宿で友達と飲みに行く"}]

新しい情報がなければ: []`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) return [];

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[]';

    // JSONを抽出（```json ... ``` で囲まれている場合も対応）
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown): item is { category: string; content: string } =>
        typeof item === 'object' && item !== null &&
        'category' in item && 'content' in item &&
        typeof (item as Record<string, unknown>).category === 'string' &&
        typeof (item as Record<string, unknown>).content === 'string'
    );
  } catch {
    return [];
  }
}
