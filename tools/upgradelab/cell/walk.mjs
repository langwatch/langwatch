// A signed-in user walking traces, a trace drawer, prompts, experiments and Ops > Upgrades every
// `every` ms until <runDir>/walk.stop. cwd = <head>/apps/ui; argv[2] = JSON { url, email,
// password, runDir, originMs, every }. Errors go to browser.jsonl, first walk per phase to shots/;
// operator.granted makes it sign in again so ops:view is in the session.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const { url, email, password, runDir, originMs, every } = JSON.parse(process.argv[2]);
const log = (record) =>
  appendFileSync(
    join(runDir, "browser.jsonl"),
    JSON.stringify({ atMs: Date.now() - originMs, phase: phase(), ...record }) + "\n",
  );
const phase = () => {
  try {
    return readFileSync(join(runDir, "phase.txt"), "utf8").trim() || "main";
  } catch {
    return "main";
  }
};
const stopped = () => existsSync(join(runDir, "walk.stop"));
const dismissNudge = (page) =>
  page
    .getByRole("button", { name: "Not now" })
    .click({ timeout: 1_000 })
    .catch(() => undefined);
const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What the page showed, for a walkerror: its path and the start of its text.
const shown = async (page) =>
  `${new URL(page.url()).pathname}: ${(await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`;
const outsideAuth = (at) => !at.pathname.startsWith("/auth/");

// Signs in only when the form is there: a held session sends /auth/signin on to the app.
async function signIn(page) {
  await page.goto(`${url}/auth/signin`, { timeout: 30_000, waitUntil: "domcontentloaded" });
  const form = page
    .locator('input[type="email"]:enabled, input[name="email"]:not([type="hidden"]):enabled')
    .first();
  await Promise.race([
    form.waitFor({ timeout: 30_000 }),
    page.waitForURL(outsideAuth, { timeout: 30_000 }),
  ]).catch(() => undefined);
  if (outsideAuth(new URL(page.url()))) return;
  if (!(await form.isVisible()))
    throw new Error(`no sign-in form; page showed ${await shown(page)}`);
  await form.fill(email);
  const field = page.locator('input[type="password"]').first();
  if (!(await field.isVisible())) await page.locator('button[type="submit"]').first().click();
  await field.fill(password, { timeout: 30_000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await dismissNudge(page);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // The lab has no internet: web fonts answer empty CSS, so a stalled DNS lookup never holds
  // the page.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  let step = "start";
  page.on(
    "console",
    (message) =>
      message.type() === "error" &&
      log({ kind: "console", step, url: page.url(), text: message.text().slice(0, 500) }),
  );
  page.on("pageerror", (error) =>
    log({ kind: "pageerror", step, url: page.url(), text: String(error).slice(0, 500) }),
  );
  page.on("requestfailed", (request) =>
    log({
      kind: "requestfailed",
      step,
      url: request.url(),
      text: request.failure()?.errorText ?? "",
    }),
  );
  page.on("response", async (response) => {
    if (response.status() < 400) return;
    const text =
      response.status() === 503 ? (await response.text().catch(() => "")).slice(0, 300) : "";
    log({
      kind: "http",
      step,
      url: response.url(),
      status: response.status(),
      text,
      retryAfter: response.headers()["retry-after"] ?? "",
    });
  });

  let project = "";
  const shot = new Set();
  let granted = false;
  while (!stopped()) {
    try {
      if (!granted && existsSync(join(runDir, "operator.granted"))) {
        granted = true;
        project = "";
        // Off the signed-in page first, so nothing it still fetches goes out without the cookie.
        await page.goto("about:blank");
        await page.context().clearCookies();
      }
      if (!project) {
        step = "signin";
        await signIn(page);
        // Sign-in may pass through "/" before the app lands on a project.
        await page
          .waitForURL((at) => outsideAuth(at) && at.pathname !== "/", { timeout: 15_000 })
          .catch(() => undefined);
        project = new URL(page.url()).pathname.split("/")[1] ?? "";
        if (["auth", ""].includes(project))
          throw new Error(`signed in but on no project; page showed ${await shown(page)}`);
      }
      const pages = [
        ["traces", `/${project}/messages`],
        ["prompts", `/${project}/prompts`],
        ["experiments", `/${project}/experiments`],
        ["upgrades", "/ops/upgrades"],
        ["signin", "/auth/signin"],
        ["settings", "/settings"],
      ];
      for (const [name, path] of pages) {
        step = name;
        await page.goto(`${url}${path}`, { timeout: 30_000, waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        if (name === "traces") {
          step = "trace-drawer";
          await page
            .locator("tbody tr, [role=row]")
            .nth(1)
            .click({ timeout: 3_000 })
            .catch(() => undefined);
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        }
        await dismissNudge(page);
        const denied =
          name === "upgrades" &&
          (await page
            .getByText("Access Restricted")
            .first()
            .isVisible()
            .catch(() => false));
        if (
          !shot.has(`${phase()}/${name}`) &&
          name !== "prompts" &&
          name !== "experiments" &&
          !denied
        ) {
          shot.add(`${phase()}/${name}`);
          const file = `walk-${phase().replace(/[:/]/g, "-")}-${name}.png`;
          await page
            .screenshot({ path: join(runDir, "shots", file), fullPage: true })
            .catch(() => undefined);
        }
      }
      log({ kind: "walk", step: "done", url: page.url() });
    } catch (error) {
      log({
        kind: "walkerror",
        step,
        url: page.url(),
        text: String(error).slice(0, 300),
        shown: await shown(page),
      });
      if (!shot.has(`${phase()}/walkerror`)) {
        shot.add(`${phase()}/walkerror`);
        await page
          .screenshot({
            path: join(runDir, "shots", `walkerror-${phase().replace(/[:/]/g, "-")}.png`),
            fullPage: true,
          })
          .catch(() => undefined);
      }
      project = "";
    }
    await nap(every);
  }
} finally {
  await browser.close();
}
