/**
 * Regenerates the README screenshots from the running app.
 *   npm run build && npx vite preview --port 4173 &
 *   npx playwright install chromium   # once
 *   npm run screenshots               # writes docs/screenshots/*.png
 * BASE_URL can point at any deployment (e.g. GitHub Pages).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://localhost:4173/').replace(/\/?$/, '/');
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
async function session(theme, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto(BASE + '#/');
  await p.evaluate(t => { localStorage.clear(); localStorage.setItem('gmcp-theme', t); localStorage.setItem('gmcp-tour-seen', '1'); }, theme);
  await p.reload();
  return { ctx, p };
}
const shot = async (p, name, opts = {}) => { await p.waitForTimeout(700); await p.screenshot({ path: OUT + name + '.png', ...opts }); console.log('✓', name); };

// light, desktop
{
  const { ctx, p } = await session('light', { width: 1440, height: 900 });
  await shot(p, 'landing');
  await p.click('text=Start exploring →'); await p.waitForURL(/#\/app/);
  // keep the shots clean: collapse the guest help boxes
  for (const k of ['dashboard', 'servers', 'policies', 'approvals', 'audit', 'playground', 'agents', 'tests']) await p.evaluate(k => localStorage.setItem('gmcp-help-' + k, '0'), k);
  await p.goto(BASE + '#/app/dashboard'); await shot(p, 'dashboard');
  await p.goto(BASE + '#/app/policies'); await shot(p, 'guardrails');
  await p.click('button:has-text("Simulate") >> nth=0'); await p.waitForSelector('.modal tbody tr'); await shot(p, 'simulate');
  await p.keyboard.press('Escape');
  await p.goto(BASE + '#/app/approvals'); await shot(p, 'approvals');
  await p.goto(BASE + '#/app/audit'); await p.waitForTimeout(500); await p.click('tr.clickable >> nth=0'); await shot(p, 'audit');
  await p.keyboard.press('Escape');
  await p.goto(BASE + '#/app/playground'); await p.waitForTimeout(600); await p.click('text=▶ Call tool'); await shot(p, 'playground');
  await p.goto(BASE + '#/app/servers'); await p.click('a.card >> nth=0'); await p.click('.tabs button:has-text("Tools")'); await shot(p, 'server-tools');
  await p.goto(BASE + '#/app/agents'); await shot(p, 'agents');
  await ctx.close();
}
// dark, desktop
{
  const { ctx, p } = await session('dark', { width: 1440, height: 900 });
  await p.click('text=Start exploring →'); await p.waitForURL(/#\/app/);
  await p.evaluate(() => localStorage.setItem('gmcp-help-dashboard', '0'));
  await p.goto(BASE + '#/app/dashboard'); await shot(p, 'dashboard-dark');
  await ctx.close();
}
// mobile
{
  const { ctx, p } = await session('light', { width: 390, height: 844 });
  await shot(p, 'mobile-landing');
  await p.click('text=Start exploring →'); await p.waitForURL(/#\/app/);
  await shot(p, 'mobile-dashboard');
  await ctx.close();
}
await browser.close();
