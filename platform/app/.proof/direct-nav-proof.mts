import http from "node:http";
import { chromium } from "playwright";
import { buildChartFrameHeaders, buildChartFrameHtml, CHART_FRAME_PATH } from "../src/server/chartSandboxFrame";
const html = buildChartFrameHtml();
const headers = buildChartFrameHeaders();
const server = http.createServer((req, res) => {
  if (req.url === CHART_FRAME_PATH) { for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.end(html); return; }
  res.setHeader("Set-Cookie", "session=secret; Path=/");
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><script>document.cookie="session=secret";</script><body>app origin, cookie set</body>`);
});
await new Promise<void>((r) => server.listen(4798, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:4798/");
await page.goto("http://localhost:4798" + CHART_FRAME_PATH);
await page.waitForTimeout(3000);
const origin = await page.evaluate(() => { try { return window.origin + " cookie=" + JSON.stringify(document.cookie); } catch (e) { return "THREW " + String(e); } });
console.log("top-level navigation origin/cookie:", origin);
const parentIsSelf = await page.evaluate(() => window.parent === window);
console.log("window.parent === window:", parentIsSelf);
const ran = await page.evaluate(() => new Promise<string>((resolve) => {
  (window as any).__probe = "untouched";
  window.postMessage({ type: "lw:init", dashboardContext: { theme: "light" }, params: {}, source: "window.__probe = 'PWNED'; export default () => null;" }, "*", [new MessageChannel().port2]);
  setTimeout(() => resolve(String((window as any).__probe) + " authorSource=" + JSON.stringify((window as any).__LW_AUTHOR_SOURCE__)), 2500);
}));
console.log("self-posted lw:init result:", ran);
await browser.close(); server.close();
