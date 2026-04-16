/**
 * リッチメニューセットアップスクリプト
 *
 * 実行方法:
 *   npx tsx scripts/setup-richmenu.ts
 *
 * 必要な環境変数:
 *   LINE_CHANNEL_ACCESS_TOKEN
 *
 * リッチメニュー画像は scripts/richmenu.png を使用
 */

import * as fs from 'fs';
import * as path from 'path';

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
  process.exit(1);
}

const PORTAL_URL = 'https://bkdj5.github.io/habit-tracker/portal/';

const richMenuBody = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'リズ メインメニュー',
  chatBarText: 'メニュー',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=menu_record', displayText: '今日の記録' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'postback', data: 'action=menu_list', displayText: '習慣一覧' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=menu_settings', displayText: '設定' },
    },
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: 'uri', uri: `${PORTAL_URL}#logs` },
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: 'uri', uri: `${PORTAL_URL}#tracker` },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=menu_help', displayText: 'ヘルプ' },
    },
  ],
};

async function main() {
  console.log('=== リッチメニュー セットアップ ===\n');

  // 1. 既存のデフォルトリッチメニューを削除
  console.log('1. 既存のデフォルトリッチメニューを確認...');
  try {
    const defaultRes = await fetch(`${LINE_API_BASE}/user/all/richmenu`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (defaultRes.ok) {
      const data = (await defaultRes.json()) as { richMenuId?: string };
      if (data.richMenuId) {
        console.log(`   既存メニュー ${data.richMenuId} を削除します`);
        await fetch(`${LINE_API_BASE}/richmenu/${data.richMenuId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        console.log('   削除完了');
      }
    }
  } catch {
    console.log('   既存メニューなし');
  }

  // 2. リッチメニュー作成
  console.log('\n2. リッチメニューを作成...');
  const createRes = await fetch(`${LINE_API_BASE}/richmenu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(richMenuBody),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`   作成失敗: ${createRes.status} ${err}`);
    process.exit(1);
  }

  const { richMenuId } = (await createRes.json()) as { richMenuId: string };
  console.log(`   作成完了: ${richMenuId}`);

  // 3. 画像アップロード
  console.log('\n3. リッチメニュー画像をアップロード...');
  const imagePath = path.join(__dirname, 'richmenu.png');

  if (!fs.existsSync(imagePath)) {
    console.error(`   画像が見つかりません: ${imagePath}`);
    console.log(`   以下のコマンドで手動アップロードしてください:`);
    console.log(`   curl -X POST https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: image/png" -T richmenu.png`);
    console.log(`\n   アップロード後、デフォルト設定:`);
    console.log(`   curl -X POST ${LINE_API_BASE}/user/all/richmenu/${richMenuId} -H "Authorization: Bearer ${TOKEN}"`);
    return;
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const uploadRes = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: imageBuffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`   アップロード失敗: ${uploadRes.status} ${err}`);
    process.exit(1);
  }
  console.log('   アップロード完了');

  // 4. デフォルトリッチメニューに設定
  console.log('\n4. デフォルトリッチメニューに設定...');
  const setDefaultRes = await fetch(
    `${LINE_API_BASE}/user/all/richmenu/${richMenuId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }
  );

  if (!setDefaultRes.ok) {
    const err = await setDefaultRes.text();
    console.error(`   設定失敗: ${setDefaultRes.status} ${err}`);
    process.exit(1);
  }
  console.log('   設定完了');

  console.log(`\n=== セットアップ完了 ===`);
  console.log(`リッチメニューID: ${richMenuId}`);
}

main().catch(console.error);
