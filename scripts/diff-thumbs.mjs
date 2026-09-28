// 틀린그림찾기 썸네일 만들기: node scripts/diff-thumbs.mjs
// puzzles.json 의 각 그림에서 왼쪽 그림을 320px 폭 JPEG 로 public/diff/thumbs/<id>.jpg 에 저장한다.
// playwright + chromium 필요 (PW_CHROMIUM 으로 실행 파일 지정 가능).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'diff', 'puzzles.json'), 'utf8'));
fs.mkdirSync(path.join(ROOT, 'diff', 'thumbs'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
for (const p of pack.puzzles) {
  const src = path.join(ROOT, p.left);
  const out = path.join(ROOT, 'diff', 'thumbs', `${p.id}.jpg`);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) continue;
  const b64 = fs.readFileSync(src).toString('base64');
  const W = 320, H = Math.round((p.height * W) / p.width);
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<html><body style="margin:0;background:#000"><img src="data:image/webp;base64,${b64}" style="display:block;width:${W}px;height:${H}px"></body></html>`);
  await page.screenshot({ path: out, type: 'jpeg', quality: 72 });
  console.log('thumb', p.id, W, H);
}
await browser.close();
