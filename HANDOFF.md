# リズ（習慣化コーチLINE Bot）引継ぎメモ

> 2026-04-16 夜セッション時点の状態。次のセッションはこのファイルを読んでから作業開始すること。

---

## アーキテクチャ

```
habit-tracker/
├── worker/           Cloudflare Workers (Hono + TypeScript)
│   └── src/
│       ├── index.ts            エントリポイント、ルーティング、秘書API
│       ├── types/index.ts      全型定義
│       ├── routes/
│       │   ├── webhook.ts      LINE Webhook受信
│       │   └── portal-api.ts   LIFF Portal用REST API（振り返りAPI含む）
│       ├── handlers/
│       │   ├── message.ts      テキストメッセージ処理（コマンド・AI会話・ログ入力待ちモード）
│       │   ├── postback.ts     ボタン・Flex操作（オンボーディング・クイック記録・今日の記録）
│       │   ├── onboarding-steps.ts  64類型プロファイリングUI
│       │   └── cron.ts         朝push・夜push・介入push
│       └── lib/
│           ├── line.ts         LINE Messaging API ヘルパー
│           ├── supabase.ts     Supabase CRUD
│           ├── coach.ts        Gemini 2.5 Flash AI会話 + extractUserInfo + リズ人格設定
│           ├── flex.ts         Flex Message構築（習慣一覧・レベルアップ）
│           ├── xp.ts           XP/レベル計算・付与・レベルアップ履歴記録
│           └── stage.ts        ステージ管理（準備期→実行期→定着期）
├── portal/
│   └── index.html    LIFF Portal（ダッシュボード・習慣管理・トラッカー・振り返り・プロフィール）
└── docs/
    ├── coaching-logic.md       コーチングロジック設計書
    └── profiling-64types.md    64類型プロファイリング設計書
```

---

## 外部サービス

| サービス | 用途 | 備考 |
|---|---|---|
| Cloudflare Workers | API・Webhook | `npx wrangler deploy` |
| Supabase (swmvxrzqhujcpdbvdzdf) | PostgreSQL | テーブル設計は docs/database-design.sql |
| LINE Messaging API | Bot | 無料プラン月200 push。reply無制限 |
| Gemini 2.5 Flash | AI会話 | thinkingBudget:128（0にすると品質劣化） |
| GitHub Pages | Portal配信 | imagawadaigo.github.io/habit-tracker/portal/ |
| LIFF (2009812050-xxV0jxwk) | LINE内ブラウザ認証 | |

---

## 完了済み機能

### Phase 1（コア機能）
- [x] 64類型プロファイリング（M1-4 / F1-4 / R1-4）
- [x] ステージ管理（preparation → execution_early → execution_mid → established）
- [x] 通数最適化（夜push条件化、介入push）
- [x] プロファイリング反映（朝push/夜push/記録フィードバック全てにM/F/R分岐）
- [x] ストリーク（current_streak/max_streak、最低ライン維持）
- [x] アンカー習慣（トリガー設定、朝push表示）
- [x] XP/レベルシステム（xpForLevel = 25*L*(L-1)、記録/ログ/ストリーク/全達成ボーナス）
- [x] レベルアップ演出Flex Message
- [x] レベルアップ履歴記録（level_up_historyテーブル、grantXpで自動記録）
- [x] AI会話（Gemini、プロファイル・習慣・記録・メモ・履歴を全注入）
- [x] リズ人格設定（20代女性、生活リズムあり、時間帯に合った応答）
- [x] SNS/LINE用語辞書（草、それな、ワンチャン等20語以上）
- [x] extractUserInfo（会話からuser_notesを自動抽出・保存）
- [x] Flex記録ボタン（達成/最低ライン、記録後に更新済みFlex再表示）
- [x] ひとことログ（「ログ 〇〇」コマンド、1日1回+10XP）
- [x] ログ入力待ちモード（menu_record → pending_action → 次のフリーテキストをログ保存）
- [x] 夜pushでログ促し（全パターンに「ログ 〇〇 で +10 XP」案内追加）
- [x] 秘書API（GET /api/summary — 河了貂用）
- [x] リッチメニュー作成API（POST /api/setup-richmenu）

### Portal（LP）
- [x] ダッシュボード（レベルカード、今日の習慣、達成率、レベルアップ履歴）
- [x] 習慣管理（追加・編集・削除）
- [x] 月間トラッカー（登録日基準の達成率計算）
- [x] 振り返り（日次/週次/月次タブ切替）
  - 日次: 日付ナビ + 習慣達成状況 + ログ表示
  - 週次: 全体達成率 + 日別バーチャート + 習慣別サマリー + ハイライト
  - 月次: 達成率 + カレンダーヒートマップ + 習慣別 + ハイライト + レベルアップ履歴
- [x] プロフィール表示（タイプ・レベル・XP）
- [x] LIFF認証

### リッチメニュー動作

| ボタン | action | 動作 |
|---|---|---|
| 今日の記録 | menu_record | 時間帯別声かけFlex + ログ入力待ちモード |
| 習慣一覧 | menu_list | 習慣一覧Flex（達成/最低ラインボタン付き） |
| 設定 | menu_settings | 設定メニューFlex |
| ログ | URI | LP #logs（振り返りタブ） |
| トラッカー | URI | LP #tracker |
| ヘルプ | menu_help | コマンド一覧テキスト |

---

## 未着手タスク

### 優先度: 中
| ID | タスク | 概要 |
|---|---|---|
| C3 | 達成率推移グラフ | LP上に週/月単位の達成率折れ線グラフ |
| D2 | 称号・バッジシステム | 特定条件達成でバッジ付与（7d連続、Lv5到達等） |

### 優先度: 低
| ID | タスク | 概要 |
|---|---|---|
| B2 | 数値記録 | 体重・学習時間等の数値トラッキング |
| C2 | XP推移グラフ | LP上にXP累積推移を可視化 |

### Phase 2（次フェーズ）
| ID | タスク | 状態 |
|---|---|---|
| 2-1 | LIFF統合強化 | 部分完了。習慣追加・編集フォームUIをLIFF内に実装する余地あり |
| 2-2 | AIコーチ強化 | 部分完了。週次サマリー未実装、coach-prompt.ts分離未実施 |
| 2-3 | 収益モデル | 未着手。無料3個/プレミアム480円の設計あり |

### その他
- リッチメニュー画像の作成・アップロード（APIは完成、画像未作成）
- 日記方向への進化: 「今日の記録」をchat内で対話して1日を整理する方向に発展させる構想あり（AI要約→daily_logsへ自動格納）

---

## 技術的注意点

1. **Gemini thinkingBudget は 128 を維持**。0にすると会話品質が著しく劣化し余計な記号が入る。extractUserInfoのthinkingBudgetだけは0でOK
2. **LINE Flex Messageのtext fieldは空文字不可**。空になりうる箇所は filler を使う
3. **LINE Flex Messageで `paddingTop` / `paddingBottom` 等は box でのみ使用可能**。text / button に付けるとLINE APIが400を返す。代わりに `margin` を使うこと
4. **reply-first パターン**：handleFreeTextではreplyMessageをDB保存より先に呼び、saveChatMessageは非同期で後処理
5. **LINE無料プラン月200通**。朝push毎日(30) + 夜push条件付き(~15) + 介入(~5) = 約50通/ユーザー/月。4人で200通
6. **XP公式**: 必要累計XP = 25 * level * (level - 1)。Lv2=50, Lv3=150, Lv4=300
7. **月間トラッカー**: 登録日以前のセルは空欄表示、達成率は登録日からの経過日数が母数
8. **`wrangler secret put` は必ず対象プロジェクトのディレクトリで実行する**。実行前に `grep name wrangler.toml` でWorker名を確認。別プロジェクトのデプロイで上書きされる事故あり（2026-04-16障害）
9. **pending_action カラム**: user_profilesに追加済み。menu_record → 'log_input' → 次のフリーテキストをログ保存。コマンド実行時は自動クリア

---

## 障害記録: 2026-04-16 LINE Bot無反応

### 症状
「一覧」「今日の記録」等すべてのメッセージに対して既読スルー（無反応）

### 根本原因（2つの複合）

**原因1: LINE_CHANNEL_ACCESS_TOKENの上書き**
別プロジェクト（Alexa AI Assistant or 入室LINE通知）のデプロイ時に、Cloudflare Workers secretsの `LINE_CHANNEL_ACCESS_TOKEN` が別のLINEチャンネルのトークンで上書きされた。

**原因2: Flex Messageの `paddingTop` プロパティ**
`flex.ts` の習慣一覧Flex内でtext/boxに `paddingTop: '4px'` を使用していたが、LINE Messaging APIが400エラーで拒否。`waitUntil` 内のcatchが `console.error` のみだったため「無反応」に見えた。

### 修正内容

1. 正しいLINE_CHANNEL_ACCESS_TOKENを `wrangler secret put` で再設定
2. `flex.ts`: `paddingTop` → `margin` に修正（3箇所）
3. `webhook.ts`: デバッグコード除去、本番コード復元
4. `postback.ts` / `message.ts`: Flex送信失敗時にユーザーにテキストでエラー通知するcatch追加

### 再発防止策

1. `wrangler secret put` 実行前に `grep name wrangler.toml` でWorker名を確認
2. Flex Messageの新規プロパティ追加時は LINE Flex Message Simulator で事前検証
3. `waitUntil` 内のエラーは必ずユーザーに通知する（console.errorだけにしない）

---

## DBテーブル追加（本セッション）

- `level_up_history`: レベルアップ日時を記録。`user_id`, `new_level`, `total_xp`, `created_at`
- `user_profiles.pending_action`: ログ入力待ちモード用。'log_input' or null

---

## DBユーザー状態（2026-04-16時点）

- nickname: だいご
- type_code: M3-F1-R4（他者駆動・動機減衰・最小行動回復）
- coach_tone: aniki, coach_style: gentle
- level: 1, total_xp: 30
- life_rhythm: night
- 習慣: 「朝起きる」（達成: 布団から出てパソコンを触る / 最低: 水分補給をする）

---

## git状態

- 全コミットpush済み（mainブランチ、clean）
- GitHub Pages反映済み

---

## 今回のセッション（2026-04-16夜）で実施したこと

1. **LINE Bot障害修正** — TOKEN上書き + Flex paddingTopエラーの2つを特定・修正
2. **リズ人格設定** — 20代女性の生活設定、現在時刻注入、時間帯に合った応答
3. **SNS用語辞書** — 草、それな、ワンチャン等20語以上をプロンプトに追加
4. **menu_record分離** — 「今日の記録」を習慣一覧と分離、ログ入力待ちモード実装
5. **振り返りUI全面刷新** — LP「Log」→「Review」タブに変更、日次/週次/月次の3画面
6. **振り返りAPI 3本** — /review/daily, /review/weekly, /review/monthly
7. **レベルアップ履歴** — DB + API + Home表示 + 月次振り返り内表示
8. **障害記録文書化** — HANDOFF.mdに原因・修正・再発防止策を追記
