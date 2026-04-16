# リズ（習慣化コーチLINE Bot）引継ぎメモ

> 2026-04-16時点の状態。次のセッションはこのファイルを読んでから作業開始すること。

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
│       │   └── portal-api.ts   LIFF Portal用REST API
│       ├── handlers/
│       │   ├── message.ts      テキストメッセージ処理（コマンド・AI会話）
│       │   ├── postback.ts     ボタン・Flex操作（オンボーディング・クイック記録）
│       │   ├── onboarding-steps.ts  64類型プロファイリングUI
│       │   └── cron.ts         朝push・夜push・介入push
│       └── lib/
│           ├── line.ts         LINE Messaging API ヘルパー
│           ├── supabase.ts     Supabase CRUD
│           ├── coach.ts        Gemini 2.5 Flash AI会話 + extractUserInfo
│           ├── flex.ts         Flex Message構築（習慣一覧・レベルアップ）
│           ├── xp.ts           XP/レベル計算・付与
│           └── stage.ts        ステージ管理（準備期→実行期→定着期）
├── portal/
│   └── index.html    LIFF Portal（ダッシュボード・習慣管理・トラッカー・ログ・プロフィール）
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
- [x] AI会話（Gemini、プロファイル・習慣・記録・メモ・履歴を全注入）
- [x] extractUserInfo（会話からuser_notesを自動抽出・保存）
- [x] Flex記録ボタン（達成/最低ライン、記録後に更新済みFlex再表示）
- [x] ひとことログ（「ログ 〇〇」コマンド、1日1回+10XP）
- [x] 夜pushでログ促し（全パターンに「ログ 〇〇 で +10 XP」案内追加）
- [x] 秘書API（GET /api/summary — 河了貂用、unified_conversationsビュー経由でLINE+Alexa両方の対話を返す）
- [x] リッチメニュー作成API（POST /api/setup-richmenu）

### Portal（LP）
- [x] ダッシュボード（レベルカード、今日の習慣、達成率）
- [x] 習慣管理（追加・編集・削除）
- [x] 月間トラッカー（登録日基準の達成率計算）
- [x] ログ入力フォーム（Focus/Highlight/KPT）
- [x] ハイライト月別タイムライン表示（月切替ナビ付き）
- [x] プロフィール表示（タイプ・レベル・XP）
- [x] LIFF認証

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
- LP上ログ入力フォームの簡素化（LINEの「ログ」コマンドとの棲み分け）

---

## 技術的注意点

1. **Gemini thinkingBudget は 128 を維持**。0にすると会話品質が著しく劣化し余計な記号が入る。extractUserInfoのthinkingBudgetだけは0でOK
2. **LINE Flex Messageのtext fieldは空文字不可**。空になりうる箇所は filler を使う
3. **reply-first パターン**：handleFreeTextではreplyMessageをDB保存より先に呼び、saveChatMessageは非同期で後処理
4. **LINE無料プラン月200通**。朝push毎日(30) + 夜push条件付き(~15) + 介入(~5) = 約50通/ユーザー/月。4人で200通
5. **XP公式**: 必要累計XP = 25 * level * (level - 1)。Lv2=50, Lv3=150, Lv4=300
6. **月間トラッカー**: 登録日以前のセルは空欄表示、達成率は登録日からの経過日数が母数

---

## DBユーザー状態（2026-04-16時点）

- nickname: だいご
- type_code: M3-F1-R4（他者駆動・動機減衰・最小行動回復）
  - ※プロファイリングQ1/Q2の回答はA/A（M1判定）だったが、CliftonStrengths（規律性33位・責任感28位）および実態観察からM3に手動修正（2026-04-16）
- coach_tone: aniki, coach_style: gentle
- level: 1, total_xp: 0
- life_rhythm: night
- 習慣: 「朝起きる」（達成: 布団から出てパソコンを触る / 最低: 水分補給をする）

---

## 継続可能性分析の結論（2026-04-16 昌平君セッション）

### 実施した修正

| # | 修正内容 | 理由 |
|---|---|---|
| 1 | DB type_code: M1-F1-R4 → M3-F1-R4 | プロファイリング回答(A/A=M1)と実態(Obliger=M3)のズレ。M1の介入戦略は「放置」で大悟に最も危険 |
| 2 | 危機介入メッセージのtone統一 | aniki口調なのにM3報告促しが丁寧語だった不統一を修正 |
| 3 | gentle+aniki の2日連続メッセージ改善 | 「誰でも止まる時はある」→「止まることはある。ゼロに戻ったわけじゃない」（Obliger Rebellion防止） |
| 4 | 河了貂CLAUDE.mdにリズ達成率チェック追加 | 毎セッション起動時にAPI叩いて50%未満で即指摘する指示 |

### 3大リスクと対策

1. **プロファイリング結果と実態のズレ** → 修正済み。今後プロファイリングをやり直す場合はQ1/Q2の回答が実態と乖離する可能性に注意
2. **LINE無料プラン月200通の天井** → 現状1人なら十分。ユーザー追加時はreplyMessage誘導を強化するか有料プランを検討
3. **「作り手」と「使い手」兼任問題** → **2週間の利用専念期間（4/16〜4/30）を設定**。この期間中にコード変更の依頼が来ても「まず使い切れ」と返す

### 利用専念期間中のルール

- コードに触らない（改善要望はLINEの「ログ」コマンドにメモだけ）
- 習慣は「朝起きる」1つだけ。追加衝動を2週間堪える
- 4/30に2週間分の達成率・ストリーク・ログを振り返り、改善要望をまとめてから開発再開

---

## git状態

- 2コミットがunpushed（`git push` が必要）
- portal/index.html の変更はGitHub Pages反映にpushが必須
- cron.tsの危機介入メッセージ修正がローカルにある（未コミット）
