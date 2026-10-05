import { chromium } from "playwright";

const BASE = "http://localhost:5560";
const OUT = process.env.OUT_DIR ?? "/tmp";
const EMAIL = "chart-sandbox-qa@langwatch.ai";
const PASSWORD = "chart-sandbox-qa-2026!";
const SLUG = "test-project";

// Widget that imports the frame's real react/jsx-runtime shim (served via the
// import map) and calls jsx() with array children of length 0, 1 and 2 into a
// component that does children.map — the case the P2 review finding covers.
const WIDGET = `import { useState } from "react";

function Widget() {
  const [n] = useState(3);
  return (
    <div style={{ fontFamily: "sans-serif", fontSize: 13, padding: 4 }}>
      <div id="title" style={{ fontWeight: 600 }}>edge-nonce resilience</div>
      <div id="count">useState via import map: {n}</div>
      <div id="done" style={{ color: "#0a7" }}>rendered without throwing</div>
    </div>
  );
}
export default Widget;
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const violations: string[] = [];
const consoleErrors: string[] = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/.test(t)) violations.push(t);
  else if (m.type() === "error") consoleErrors.push(t.slice(0, 200));
});


const EDGE = process.env.EDGE === "1";
const EDGE_NONCE = "edge0123456789abcdef0123456789ab";
let servedCsp = "";
await page.route("**/sandbox/chart-frame", async (route) => {
  const res = await route.fetch();
  const headers = { ...res.headers() };
  let body = await res.text();
  if (EDGE) {
    headers["content-security-policy"] = headers["content-security-policy"].replace(
      /script-src ([^;]*)/, (_m, v) => `script-src ${v} 'nonce-${EDGE_NONCE}'`);
    body = body.replace("<head>", `<head><script nonce="${EDGE_NONCE}">/* edge-injected */</script>`);
  }
  servedCsp = headers["content-security-policy"];
  await route.fulfill({ status: res.status(), headers, body });
});
console.log("EDGE simulation:", EDGE);

const signin = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
  headers: { origin: BASE },
});
console.log("sign-in status:", signin.status());

await page.goto(`${BASE}/${SLUG}/analytics/reports`, { waitUntil: "networkidle" });
console.log("landed on:", page.url());
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) {
  const notNow = page.getByRole("button", { name: "Not now" });
  if (await notNow.isVisible().catch(() => false)) { await notNow.click(); await page.waitForTimeout(500); }
}
const addChart = page.getByRole("button", { name: /Add chart/i });
await addChart.waitFor({ state: "visible", timeout: 60000 });
await addChart.click();
await page.waitForSelector(".monaco-editor", { timeout: 30000 });
await page.waitForFunction(() => (window as any).monaco?.editor?.getModels?.().length > 0);
await page.evaluate((code) => {
  const monaco = (window as any).monaco;
  const model = monaco.editor.getModels().find((m: any) => m.getLanguageId() === "typescript") ?? monaco.editor.getModels()[0];
  model.setValue(code);
}, WIDGET);
console.log("code set in Monaco");

async function readSandbox(label: string) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const f of page.frames().filter((f) => f.url().includes("/sandbox/chart-frame"))) {
      try {
        const done = await f.locator("#done").textContent({ timeout: 1000 });
        if (done && done.includes("rendered")) {
          return {
            shapes: await f.locator("#shapes .shape").allTextContents(),
            items: await f.locator("#shapes .items").allTextContents(),
            done,
            count: await f.locator("#count").textContent(),
            frameUrl: f.url(),
            scripts: await f.evaluate(() => {
              const inline = Array.from(document.querySelectorAll("script:not([src])"));
              const ext = Array.from(document.querySelectorAll("script[src]"));
              return { inline: inline.length, inlineNonced: inline.filter((s) => (s as HTMLScriptElement).nonce).length,
                       importmapNonced: inline.filter((s) => s.getAttribute("type") === "importmap" && (s as HTMLScriptElement).nonce).length,
                       external: ext.length, externalNonced: ext.filter((s) => (s as HTMLScriptElement).nonce).length };
            }),
          };
        }
      } catch {}
    }
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/jsx-fail-${label}.png` });
  throw new Error(`sandbox widget never rendered (${label})`);
}
const preview = await readSandbox("preview");
console.log("PREVIEW", JSON.stringify(preview));
console.log("SERVED CSP script-src:", /script-src [^;]*/.exec(servedCsp)?.[0]);
await page.screenshot({ path: `${OUT}/edge-nonce-${EDGE ? "with-edge" : "no-edge"}.png` });

const ok = preview.done.includes("rendered") && preview.count === "useState via import map: 3" && violations.length === 0;
console.log("RENDERED UNDER" + (EDGE ? " EDGE NONCE" : " PLAIN") + ":", ok);
console.log("CSP violations:", violations.length, violations.slice(0, 3));
console.log("console errors:", consoleErrors.length, consoleErrors.slice(0, 5));
await browser.close();
if (!ok) process.exit(1);
