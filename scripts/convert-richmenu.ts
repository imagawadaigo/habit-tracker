/**
 * リッチメニューSVG → PNG変換
 * 実行: npx tsx scripts/convert-richmenu.ts
 *
 * sharp が必要: npm i -D sharp @types/sharp
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const svgPath = path.join(__dirname, 'richmenu.svg');
const pngPath = path.join(__dirname, 'richmenu.png');

async function main() {
  const svgBuffer = fs.readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(2500, 1686)
    .png()
    .toFile(pngPath);

  console.log(`変換完了: ${pngPath}`);
  const stats = fs.statSync(pngPath);
  console.log(`サイズ: ${Math.round(stats.size / 1024)} KB`);
}

main().catch(console.error);
