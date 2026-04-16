/**
 * リッチメニューセットアップスクリプト
 *
 * 実行方法:
 *   LINE_CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-richmenu.js
 */

const fs = require('fs');
const path = require('path');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
  console.error('実行例: LINE_CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-richmenu.js');
  process.exit(1);
}

const PORTAL_URL = 'https://imagawadaigo.github.io/habit-tracker/portal/';

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

  // 1. 既存のデフォルトリッチメニューを確認・削除
  console.log('1. 既存リッチメニューを確認...');
  try {
    const listRes = await fetch(`${LINE_API_BASE}/richmenu/list`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      if (listData.richmenus && listData.richmenus.length > 0) {
        for (const menu of listData.richmenus) {
          console.log(`   既存メニュー ${menu.richMenuId} (${menu.name}) を削除`);
          await fetch(`${LINE_API_BASE}/richmenu/${menu.richMenuId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${TOKEN}` },
          });
        }
      }
    }
  } catch (e) {
    console.log('   既存メニューなし');
  }

  // 2. リッチメニュー作成
  console.log('\n2. リッチメニュー作成...');
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

  const { richMenuId } = await createRes.json();
  console.log(`   作成完了: ${richMenuId}`);

  // 3. 画像アップロード
  console.log('\n3. 画像アップロード...');
  const imagePath = path.join(__dirname, 'richmenu.png');

  if (!fs.existsSync(imagePath)) {
    console.error(`   画像なし: ${imagePath}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  console.log(`   画像サイズ: ${Math.round(imageBuffer.length / 1024)} KB`);

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

  // 4. デフォルトに設定
  console.log('\n4. デフォルトリッチメニューに設定...');
  const setRes = await fetch(
    `${LINE_API_BASE}/user/all/richmenu/${richMenuId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }
  );

  if (!setRes.ok) {
    const err = await setRes.text();
    console.error(`   設定失敗: ${setRes.status} ${err}`);
    process.exit(1);
  }
  console.log('   設定完了');

  console.log(`\n=== 完了 ===`);
  console.log(`リッチメニューID: ${richMenuId}`);
}

main().catch(console.error);
