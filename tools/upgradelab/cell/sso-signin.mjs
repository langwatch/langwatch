// Plain members signing in through SSO for an upgradelab cell (E6, E7). cwd = <head>/apps/ui;
// argv[2] = JSON { url, phase, project, stateDir, shots, members: [{ email, inviteCode, door,
// connectionId, project? }] }. Prints one JSON line per check (phase, member, door, check, ok,
// url, detail). Phase test-login is the go-live round trip; head first replays main's cookie.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const { url, phase, project, stateDir, shots, members } = JSON.parse(process.argv[2]);
mkdirSync(stateDir, { recursive: true });
const emit = (record) => console.log(JSON.stringify({ phase, ...record }));
const shown = async (page) =>
  `${new URL(page.url()).pathname}: ${(await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`;
// Signed in: on the member's project (the SAML one has its own), or on /me, the personal page a
// member with no project of their own lands on.
const onProject = (at, member) =>
  at.origin === new URL(url).origin &&
  [member?.project ?? project, "me"].includes(at.pathname.split("/")[1]);
const atAuth = (at) => at.pathname.startsWith("/auth/");
const stateFile = (member) => join(stateDir, `${member.email.replace(/[^a-z0-9]+/gi, "-")}.json`);

async function newContext(browser, storageState) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState,
    // Legacy-sso cells put idpsim behind a leaf of the cell's own CA; Chromium reads only the OS
    // store, so the browser waives the check the releases make through NODE_EXTRA_CA_CERTS.
    ignoreHTTPSErrors: true,
  });
  // The lab has no internet: web fonts answer empty CSS so a stalled DNS lookup never holds
  // the page.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  return context;
}

// A blank page's evidence: console, page errors, failed or 4xx/5xx requests, and at the end what
// the DOM holds. Written to sso/<member>-console.jsonl; the summary joins the verdict detail.
function watch(page, member, check) {
  const file = join(stateDir, `${member.email.replace(/[^a-z0-9]+/gi, "-")}-console.jsonl`);
  const seen = [];
  const note = (record) => {
    seen.push(record);
    appendFileSync(
      file,
      `${JSON.stringify({ phase, check, at: new Date().toISOString(), ...record })}\n`,
    );
  };
  const path = (raw) => new URL(raw).pathname;
  page.on("console", (message) =>
    note({ kind: `console.${message.type()}`, text: message.text().slice(0, 2000) }),
  );
  page.on("pageerror", (error) =>
    note({ kind: "pageerror", text: String(error.stack ?? error).slice(0, 2000) }),
  );
  page.on("requestfailed", (request) =>
    note({
      kind: "requestfailed",
      text: `${request.method()} ${path(request.url())}: ${request.failure()?.errorText}`,
    }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      note({ kind: "response", text: `${response.status()} ${path(response.url())}` });
  });
  return async () => {
    const dom = await page
      .evaluate(() => ({
        boot: Boolean(document.getElementById("lw-boot")),
        body: [...document.body.children].map(
          (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}[${el.childElementCount}]`,
        ),
        root: document.getElementById("root")?.innerHTML.slice(0, 600) ?? null,
      }))
      .catch((error) => ({ error: String(error).slice(0, 200) }));
    note({ kind: "dom", text: JSON.stringify(dom) });
    const loud = seen.filter((record) =>
      /error|pageerror|requestfailed|response/.test(record.kind),
    );
    return `; dom ${JSON.stringify(dom).slice(0, 400)}; ${loud.length} errors${
      loud.length
        ? `: ${loud
            .slice(0, 4)
            .map((record) => `${record.kind} ${record.text.slice(0, 200)}`)
            .join(" | ")}`
        : ""
    }`;
  };
}

async function snap(page, member, check) {
  const file = `sso-${phase}-${check}-${member.email.replace(/[^a-z0-9]+/gi, "-")}.png`;
  await page.screenshot({ path: join(shots, file), fullPage: true }).catch(() => undefined);
}

// The cookie main issued: still a session, or a clean way back to sign in; never a 5xx or a
// blank page.
async function checkCookie(browser, member) {
  const base = { member: member.email, door: member.door, check: "cookie" };
  if (!existsSync(stateFile(member)))
    return emit({ ...base, ok: false, url: "", detail: "main left no session to carry over" });
  const context = await newContext(browser, stateFile(member));
  const page = await context.newPage();
  const evidence = watch(page, member, "cookie");
  let worst = 0;
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) worst = Math.max(worst, response.status());
  });
  await page
    .goto(`${url}/${member.project ?? project}`, { timeout: 30_000, waitUntil: "domcontentloaded" })
    .catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // The boot screen stays over the page until the app draws; judge the app, not the boot screen.
  const bootStuck = await page
    .waitForSelector("#lw-boot", { state: "detached", timeout: 30_000 })
    .then(
      () => false,
      () => true,
    );
  if (bootStuck) {
    await snap(page, member, "cookie");
    await context.close();
    return emit({
      ...base,
      ok: false,
      url: page.url(),
      detail: "the boot screen never left within 30 s",
    });
  }
  // Releases before the boot screen's fix drop it when the theme's <style> lands, a moment before
  // the page itself: give the page the same 30 s to draw.
  await page
    .waitForFunction(() => document.body.innerText.trim() !== "", undefined, { timeout: 30_000 })
    .catch(() => undefined);
  const at = new URL(page.url());
  const blank = (await page.innerText("body").catch(() => "")).trim() === "";
  let outcome = "neither";
  if (onProject(at, member)) outcome = "still signed in";
  else if (atAuth(at)) outcome = "sent to sign in";
  const ok = worst < 500 && !blank && outcome !== "neither";
  emit({
    ...base,
    ok,
    url: page.url(),
    detail: `${outcome}; worst navigation ${worst}; ${await shown(page)}${await evidence()}`,
  });
  if (!ok) await snap(page, member, "cookie");
  await context.close();
}

// idpsim signs in whoever login_hint names; only a broker passes the typed address on.
async function hinted(browser, member) {
  const context = await newContext(browser);
  await context.route(/\/oauth\/authorize/, (route) => {
    const to = new URL(route.request().url());
    if (to.searchParams.get("login_hint")) return route.continue();
    to.searchParams.set("login_hint", member.email);
    return route.fulfill({ status: 302, headers: { location: to.toString() } });
  });
  // SAML: idpsim reads login_hint off the SSO URL whichever binding carries the request.
  await context.route(/\/saml\/sso/, (route) => {
    const to = new URL(route.request().url());
    if (to.searchParams.get("login_hint")) return route.continue();
    to.searchParams.set("login_hint", member.email);
    return route.continue({ url: to.toString() });
  });
  return context;
}

// The setup page's "Test sign-in" button: better-auth's sso sign-in for the connection, then the
// round trip.
async function testLogin(browser, member) {
  const base = { member: member.email, door: member.door, check: "test-login" };
  const context = await hinted(browser, member);
  const page = await context.newPage();
  try {
    await page.goto(`${url}/auth/signin`, { timeout: 30_000, waitUntil: "domcontentloaded" });
    const answer = await page.request.post(`${url}/api/auth/sign-in/sso`, {
      data: { providerId: member.connectionId, callbackURL: `${url}/` },
      headers: { origin: url },
    });
    const body = await answer.json().catch(() => ({}));
    if (!answer.ok() || !body.url)
      throw new Error(
        `sign-in/sso answered ${answer.status()}: ${JSON.stringify(body).slice(0, 200)}`,
      );
    await page.goto(body.url, { timeout: 30_000, waitUntil: "domcontentloaded" });
    await page
      .waitForURL((at) => at.origin === new URL(url).origin && !at.pathname.startsWith("/api/"), {
        timeout: 30_000,
      })
      .catch(() => undefined);
    const at = new URL(page.url());
    const ok =
      at.origin === new URL(url).origin &&
      !at.searchParams.get("error") &&
      !at.pathname.includes("error");
    emit({
      ...base,
      ok,
      url: page.url(),
      detail: ok ? "back from the identity provider" : `ended on ${await shown(page)}`,
    });
    if (!ok) await snap(page, member, "test-login");
  } catch (error) {
    emit({
      ...base,
      ok: false,
      url: page.url(),
      detail: `${String(error).slice(0, 300)}; page showed ${await shown(page)}`,
    });
    await snap(page, member, "test-login");
  }
  await context.close();
}

async function signIn(browser, member) {
  const base = { member: member.email, door: member.door, check: "signin" };
  const context = await hinted(browser, member);
  const page = await context.newPage();
  let step = "sign-in page";
  try {
    await page.goto(`${url}/auth/signin`, { timeout: 30_000, waitUntil: "domcontentloaded" });
    await page
      .locator('input[type="email"]:enabled, input[name="email"]:not([type="hidden"]):enabled')
      .first()
      .fill(member.email, { timeout: 30_000 });
    await page.locator('button[type="submit"]').first().click();
    step = "identity provider";
    // Under load the redirect can outlast any fixed wait, so whichever comes first: the page
    // leaves /auth, or a method picker offers the deployment's provider by name.
    const picker = page
      .getByRole("button", { name: /continue with|sign in with|single sign-on|sso|oidc|openid/i })
      .first();
    const first = await Promise.race([
      page
        .waitForURL((at) => !atAuth(at), { timeout: 45_000, waitUntil: "commit" })
        .then(() => "left"),
      picker.waitFor({ state: "visible", timeout: 45_000 }).then(() => "picker"),
    ]).catch(() => "neither");
    if (first !== "left" && atAuth(new URL(page.url()))) {
      await picker.click({ timeout: 5_000 }).catch((error) => {
        if (atAuth(new URL(page.url()))) throw error;
      });
      await page.waitForURL((at) => !atAuth(at), { timeout: 30_000, waitUntil: "commit" });
    }
    step = "landing";
    const landed = (at) => onProject(at, member);
    await page.waitForURL(landed, { timeout: 30_000, waitUntil: "commit" }).catch(() => undefined);
    const onOwnProject = new URL(page.url()).pathname.split("/")[1] === (member.project ?? project);
    if (!onOwnProject && member.inviteCode && phase === "main") {
      step = "accept invite";
      const answer = await page.request.post(`${url}/api/trpc/invite.acceptInvite`, {
        data: { json: { inviteCode: member.inviteCode } },
        headers: { origin: url },
      });
      if (!answer.ok()) step += ` (answered ${answer.status()})`;
      await page.goto(`${url}/`, { timeout: 30_000, waitUntil: "domcontentloaded" });
      await page
        .waitForURL(landed, { timeout: 30_000, waitUntil: "commit" })
        .catch(() => undefined);
    }
    const ok = landed(new URL(page.url()));
    if (ok && phase === "main") await context.storageState({ path: stateFile(member) });
    emit({
      ...base,
      ok,
      url: page.url(),
      detail: ok ? "landed on the project" : `${step}: ended on ${await shown(page)}`,
    });
    if (!ok) await snap(page, member, "signin");
  } catch (error) {
    emit({
      ...base,
      ok: false,
      url: page.url(),
      detail: `${step}: ${String(error).slice(0, 200)}; page showed ${await shown(page)}`,
    });
    await snap(page, member, "signin");
  }
  await context.close();
}

const browser = await chromium.launch({
  args: ["--disable-gpu", "--disable-accelerated-2d-canvas", "--disable-webgl"],
});
try {
  for (const member of members) {
    if (phase === "test-login") {
      await testLogin(browser, member);
      continue;
    }
    if (phase !== "main") await checkCookie(browser, member);
    await signIn(browser, member);
  }
} finally {
  await browser.close();
}
