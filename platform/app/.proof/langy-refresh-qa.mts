// Proof: an open dashboard refetches its widgets when a Langy turn settles.
//
// Opens /reports, renames the existing widget directly in Postgres (stands in
// for Langy's CLI edit), opens the Langy panel and sends a message. Locally
// no worker manager is configured, so the turn fails fast and the chat
// status settles to "error". Prints whether the grid shows the new name
// without a reload. Before the fix it keeps showing the old name.
import { execSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = "http://localhost:5560";
const OUT = process.env.OUT_DIR ?? "/tmp";
const TAG = process.env.TAG ?? "run";
const EMAIL = "chart-sandbox-qa@langwatch.ai";
const PASSWORD = "chart-sandbox-qa-2026!";
const SLUG = "test-project";
const WIDGET_ID = "_uC4Tl4Y59eHw1myu7kcL";
const OLD_NAME = "New widget";
const NEW_NAME = `Langy renamed ${Date.now()}`;

const psql = (sql: string) =>
  execSync(
    `docker exec langwatch-postgres-1 psql -U prisma -d mydb -Atc ${JSON.stringify(`set search_path=mydb; ${sql}`)}`,
  ).toString();

psql(`update "CustomGraph" set name='${OLD_NAME}' where id='${WIDGET_ID}';`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let getAllCalls = 0;
page.on("request", (req) => {
  if (req.url().includes("graphs.getAll")) getAllCalls++;
});

const signin = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
  headers: { origin: BASE },
});
console.log("sign-in status:", signin.status());

await page.goto(`${BASE}/${SLUG}/analytics/reports`, { waitUntil: "networkidle" });
const notNow = page.getByRole("button", { name: "Not now" });
if (await notNow.isVisible().catch(() => false)) await notNow.click();
await page.getByText(OLD_NAME, { exact: true }).first().waitFor({ timeout: 30000 });
const callsAtLoad = getAllCalls;
console.log("grid shows old name; graphs.getAll calls so far:", callsAtLoad);

// Langy edits the widget (stand-in for `langwatch dashboard-widget update`).
psql(`update "CustomGraph" set name='${NEW_NAME}' where id='${WIDGET_ID}';`);

await page.getByRole("button", { name: "Open Langy assistant" }).click();
const composer = page.locator('[aria-label="Langy assistant"] textarea').first();
await composer.waitFor({ timeout: 15000 });
await composer.fill("rename my widget");
await composer.press("Enter");

// Give the turn time to settle (locally: fails fast, status -> error).
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/langy-refresh-${TAG}.png` });

const refetched = getAllCalls > callsAtLoad;
const showsNew = await page.getByText(NEW_NAME, { exact: true }).first().isVisible().catch(() => false);
console.log("graphs.getAll refetched after turn settled:", refetched);
console.log("grid shows new name without reload:", showsNew);
console.log(`DASHBOARD REFRESHES AFTER LANGY TURN: ${refetched && showsNew}`);

psql(`update "CustomGraph" set name='${OLD_NAME}' where id='${WIDGET_ID}';`);
await browser.close();
