import { chromium } from "playwright";

const BASE = "http://localhost:5560";
const OUT = process.env.OUT_DIR ?? "/tmp";
const EMAIL = "chart-sandbox-qa@langwatch.ai";
const PASSWORD = "chart-sandbox-qa-2026!";
const SLUG = "test-project";

const WIDGET = `import dayjs from "dayjs";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function Widget() {
  const [lazy, setLazy] = React.useState("loading lodash-es...");
  React.useEffect(function () {
    import("lodash-es").then(function (m) {
      setLazy("lodash-es says " + m.kebabCase("Dynamic Import Works"));
    });
  }, []);
  const rows = [1, 2, 3, 4, 5].map(function (d) {
    return { day: dayjs("2024-01-0" + d).format("ddd D"), v: d * 3 };
  });
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      <div id="proof" style={{ fontSize: 12, fontWeight: 600 }}>dayjs says {dayjs("2024-01-15").format("MMMM D, YYYY")}</div>
      <div id="lazy" style={{ fontSize: 12, color: "#0a7" }}>{lazy}</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <XAxis dataKey="day" /><YAxis /><Tooltip />
            <Bar dataKey="v" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
export default React.memo(Widget);
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

// 1. Real sign-in through the BetterAuth email endpoint (cookies land in ctx).
const signin = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
  headers: { origin: BASE },
});
console.log("sign-in status:", signin.status());

// 2. Dashboards page.
await page.goto(`${BASE}/${SLUG}/analytics/reports`, { waitUntil: "networkidle" });
console.log("landed on:", page.url());
await page.screenshot({ path: `${OUT}/qa-01-reports.png` });

// 3. Dismiss the passkey nudge, then Add chart → drawer.
const notNow = page.getByRole("button", { name: "Not now" });
if (await notNow.isVisible().catch(() => false)) await notNow.click();
await page.getByRole("button", { name: "Add chart" }).click();
await page.waitForSelector(".monaco-editor", { timeout: 30000 });
await page.waitForFunction(() => (window as any).monaco?.editor?.getModels?.().length > 0);
await page.evaluate((code) => {
  const monaco = (window as any).monaco;
  const model = monaco.editor.getModels().find((m: any) => m.getLanguageId() === "typescript") ?? monaco.editor.getModels()[0];
  model.setValue(code);
}, WIDGET);
console.log("code set in Monaco");

// 4. Live preview frame inside the drawer. The preview remounts (new key)
//    when code changes, so poll page.frames() rather than holding one handle.
async function readSandbox(label: string) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const f of page.frames().filter((f) => f.url().includes("/sandbox/chart-frame"))) {
      try {
        const lazy = await f.locator("#lazy").textContent({ timeout: 1000 });
        if (lazy && lazy.includes("lodash-es says")) {
          return {
            proof: await f.textContent("#proof"),
            lazy,
            svg: await f.locator("svg.recharts-surface").count(),
            frameUrl: f.url(),
          };
        }
      } catch {}
    }
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/qa-fail-${label}.png` });
  throw new Error(`sandbox widget never rendered (${label})`);
}
const preview = await readSandbox("preview");
console.log("PREVIEW", JSON.stringify(preview));
await page.screenshot({ path: `${OUT}/qa-02-drawer-preview.png` });

// 5. Save, then reload and verify the persisted widget renders on the dashboard.
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(2000);
await page.reload({ waitUntil: "networkidle" });
const persisted = await readSandbox("persisted");
console.log("PERSISTED", JSON.stringify(persisted));
await page.screenshot({ path: `${OUT}/qa-03-dashboard-persisted.png`, fullPage: true });

const badge = await page.locator('[role="img"][aria-label*="error" i], [title*="error" i]').count();
console.log("error badges:", badge);
console.log("CSP violations:", violations.length, violations.slice(0, 3));
console.log("console errors:", consoleErrors.length, consoleErrors.slice(0, 5));
await browser.close();
