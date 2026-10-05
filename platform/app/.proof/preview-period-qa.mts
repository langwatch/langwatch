// Proof: the "New widget" drawer preview queries the dashboard's selected
// period, not a hardcoded last-24h window.
//
// Opens /reports with ?startDate=…&endDate=… (the PeriodSelector reads these),
// clicks "Add chart", and captures every analytics.lwql.query POST the
// preview sends. Prints the timeWindow it carried and whether it matches the
// URL period. Before the fix it prints a ~24h window ending "now".
import { chromium } from "playwright";

const BASE = "http://localhost:5560";
const OUT = process.env.OUT_DIR ?? "/tmp";
const EMAIL = "chart-sandbox-qa@langwatch.ai";
const PASSWORD = "chart-sandbox-qa-2026!";
const SLUG = "test-project";
const START = "2026-08-01T00:00:00.000Z";
const END = "2026-08-31T00:00:00.000Z";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const windows: { start: string; end: string }[] = [];
page.on("request", (req) => {
  if (req.method() !== "POST" || !req.url().includes("analytics.lwql.query")) return;
  const body = req.postData() ?? "";
  // superjson encodes Dates as ISO strings under json.timeWindow.{start,end}
  const m = body.match(/"timeWindow":\{"start":"([^"]+)","end":"([^"]+)"/);
  if (m) windows.push({ start: m[1]!, end: m[2]! });
});

const signin = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
  headers: { origin: BASE },
});
console.log("sign-in status:", signin.status());

await page.goto(
  `${BASE}/${SLUG}/analytics/reports?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}`,
  { waitUntil: "networkidle" },
);
console.log("landed on:", page.url());

const notNow = page.getByRole("button", { name: "Not now" });
if (await notNow.isVisible().catch(() => false)) await notNow.click();
await page.getByRole("button", { name: "Add chart" }).click();
await page.waitForSelector(".monaco-editor", { timeout: 30000 });

// Wait for the preview's first query to leave the page.
const deadline = Date.now() + 30000;
while (windows.length === 0 && Date.now() < deadline) {
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `${OUT}/preview-period-drawer.png` });

const startMs = new Date(START).getTime();
const endMs = new Date(END).getTime();
const seen = windows[0];
const spanHours = seen ? (new Date(seen.end).getTime() - new Date(seen.start).getTime()) / 36e5 : NaN;
const matches =
  !!seen &&
  Math.abs(new Date(seen.start).getTime() - startMs) < 1000 &&
  Math.abs(new Date(seen.end).getTime() - endMs) < 1000;

console.log("URL period:     ", START, "→", END);
console.log("preview sent:   ", seen ? `${seen.start} → ${seen.end}` : "(no lwql.query request captured)");
console.log("preview span(h):", spanHours.toFixed(1));
console.log("PREVIEW INHERITS DASHBOARD PERIOD:", matches);
await browser.close();
process.exit(matches ? 0 : 1);
