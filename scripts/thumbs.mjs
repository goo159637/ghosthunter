// 썸네일 만들기: node scripts/thumbs.mjs  (playwright + chromium 필요; PW_CHROMIUM 으로 실행 파일 지정 가능)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'hidden');
fs.mkdirSync(`${ROOT}/thumbs`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
for (const diff of ['easy', 'normal', 'hard', 'veryhard', 'extreme']) {
  const dir = `${ROOT}/${diff}`;
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.webp')).sort()) {
    const id = `${diff}-${path.basename(f, '.webp')}`;
    const out = `${ROOT}/thumbs/${id}.jpg`;
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(`${dir}/${f}`).mtimeMs) continue;
    const b64 = fs.readFileSync(`${dir}/${f}`).toString('base64');
    const [w, h] = await page.evaluate((src) => new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.src = src; }), `data:image/webp;base64,${b64}`);
    const W = 320, H = Math.round((320 * h) / w);
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(`<html><body style="margin:0;background:#fff"><img src="data:image/webp;base64,${b64}" style="display:block;width:${W}px;height:${H}px"></body></html>`);
    await page.screenshot({ path: out, type: 'jpeg', quality: 70 });
    console.log('thumb', id, W, H);
  }
}
await browser.close();
