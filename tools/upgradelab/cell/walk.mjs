// A signed-in user walking the app for the whole cell: traces, one trace drawer, prompts, experiments,
// Ops > Upgrades, every `every` ms. Run with cwd = <head>/apps/ui; argv[2] is JSON
// { url, email, password, runDir, originMs, every }. Stops when <runDir>/walk.stop exists.
// Appends console errors, page errors and failed requests to <runDir>/browser.jsonl, and writes
// shots/walk-<phase>.png on the first walk of each phase (phase.txt is written by the poller).
import { createRequire } from "node:module";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const { url, email, password, runDir, originMs, every } = JSON.parse(process.argv[2]);
const log = (record) =>
  appendFileSync(join(runDir, "browser.jsonl"), JSON.stringify({ atMs: Date.now() - originMs, phase: phase(), ...record }) + "\n");
const phase = () => {
  try {
    return readFileSync(join(runDir, "phase.txt"), "utf8").trim() || "main";
  } catch {
    return "main";
  }
};
const stopped = () => existsSync(join(runDir, "walk.stop"));
const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signIn(page) {
  await page.goto(`${url}/auth/signin`, { timeout: 30_000 });
  await page.locator('input[type="email"], input[name="email"]:not([type="hidden"])').first().fill(email);
  const field = page.locator('input[type="password"]').first();
  if (!(await field.isVisible())) await page.locator('button[type="submit"]').first().click();
  await field.fill(password, { timeout: 30_000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let step = "start";
  page.on("console", (message) => message.type() === "error" && log({ kind: "console", step, url: page.url(), text: message.text().slice(0, 500) }));
  page.on("pageerror", (error) => log({ kind: "pageerror", step, url: page.url(), text: String(error).slice(0, 500) }));
  page.on("requestfailed", (request) => log({ kind: "requestfailed", step, url: request.url(), text: request.failure()?.errorText ?? "" }));
  page.on("response", async (response) => {
    if (response.status() < 400) return;
    const text = response.status() === 503 ? (await response.text().catch(() => "")).slice(0, 300) : "";
    log({ kind: "http", step, url: response.url(), status: response.status(), text, retryAfter: response.headers()["retry-after"] ?? "" });
  });

  let project = "";
  const shot = new Set();
  while (!stopped()) {
    try {
      if (!project) {
        await signIn(page);
        project = new URL(page.url()).pathname.split("/")[1] ?? "";
        if (["auth", ""].includes(project)) project = "";
      }
      const pages = [["traces", `/${project}/messages`], ["prompts", `/${project}/prompts`], ["experiments", `/${project}/experiments`], ["upgrades", "/ops/upgrades"]];
      for (const [name, path] of pages) {
        step = name;
        await page.goto(`${url}${path}`, { timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        if (name === "traces") {
          step = "trace-drawer";
          await page.locator("tbody tr, [role=row]").nth(1).click({ timeout: 3_000 }).catch(() => undefined);
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        }
        if (!shot.has(`${phase()}/${name}`) && name !== "prompts" && name !== "experiments") {
          shot.add(`${phase()}/${name}`);
          const file = `walk-${phase().replace(/[:/]/g, "-")}-${name}.png`;
          await page.screenshot({ path: join(runDir, "shots", file), fullPage: true }).catch(() => undefined);
        }
      }
      log({ kind: "walk", step: "done", url: page.url() });
    } catch (error) {
      log({ kind: "walkerror", step, url: page.url(), text: String(error).slice(0, 300) });
      project = "";
    }
    await nap(every);
  }
} finally {
  await browser.close();
}
