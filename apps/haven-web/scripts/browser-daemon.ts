/**
 * `haven browser`'s daemon (tools/thuishaven/cmd/browser.go starts it): one
 * headless shell per stack, one context per lane, commands over loopback HTTP.
 * Waits are page and log events, never sleeps; stdout carries one line only.
 */
import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  watch,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { chromium, type BrowserContext, type Page } from "playwright";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: haven browser starts this daemon`);
  return value;
};
const TOKEN = env("HAVEN_BROWSER_TOKEN");
const DIR = env("HAVEN_BROWSER_DIR");
const STACK = env("HAVEN_BROWSER_STACK");
const APP = new URL(env("HAVEN_BROWSER_APP"));
const HAVEN = env("HAVEN_BROWSER_HAVEN");
const APP_LOG = process.env.HAVEN_BROWSER_APP_LOG ?? "";
const IDLE_MS = Number(process.env.HAVEN_BROWSER_IDLE_MS ?? 5 * 60_000);
const MAX_LANES = Number(process.env.HAVEN_BROWSER_MAX_LANES ?? 8);
const MAX_BUSY = Number(process.env.HAVEN_BROWSER_MAX_PAGES ?? 4);
const READY_LINE = '"msg":"backend ready"';
const RECYCLING_LINE = '"msg":"backend recycling"';

// Light flags for a shared test browser (SPIKE.md in .claude/tmp/webcrawl/haven-browser).
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--no-first-run",
    "--mute-audio",
    "--renderer-process-limit=4",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
  ],
});
browser.on("disconnected", () => process.exit(1));

type Lane = {
  name: string;
  as: string;
  context: BrowserContext;
  page: Page;
  signedOut: boolean;
  idle?: NodeJS.Timeout;
};
const lanes = new Map<string, Lane>();

/** The backend-reload gate: closed by a recycling line or a 50x, opened by the ready line. */
let backendReady: Promise<void> = Promise.resolve();
let openGate: (() => void) | undefined;
function closeGate() {
  if (openGate) return;
  backendReady = new Promise((resolve) => {
    openGate = () => {
      openGate = undefined;
      resolve();
    };
  });
}
watchAppLog({ path: APP_LOG });

function watchAppLog({ path }: { path: string }) {
  if (!path) return;
  let offset = statSafe({ path });
  // The directory, not the file: haven rotates the log by renaming it.
  watch(dirname(path), (_event, name) => {
    if (name !== basename(path)) return;
    const size = statSafe({ path });
    if (size < offset) offset = 0;
    if (size === offset) return;
    const buffer = Buffer.alloc(size - offset);
    const fd = openSync(path, "r");
    readSync(fd, buffer, 0, buffer.length, offset);
    closeSync(fd);
    offset = size;
    const text = buffer.toString("utf8");
    if (text.includes(RECYCLING_LINE)) closeGate();
    if (text.includes(READY_LINE)) openGate?.();
  });
}

/** Resolves once the backend serves; a reload that never says ready fails at the timeout. */
async function backendServes({ timeout }: { timeout: number }) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`the backend did not say ready within ${timeout} ms (haven logs app)`)),
      timeout,
    );
  });
  try {
    await Promise.race([backendReady, late]);
  } catch (error) {
    openGate?.(); // a missed ready line must not hold every later command
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function statSafe({ path }: { path: string }): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** A tiny counting semaphore: at most MAX_BUSY pages work at once. */
let busy = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>({ run }: { run: () => Promise<T> }): Promise<T> {
  if (busy >= MAX_BUSY) await new Promise<void>((resolve) => waiting.push(resolve));
  busy += 1;
  try {
    return await run();
  } finally {
    busy -= 1;
    waiting.shift()?.();
  }
}

const runHaven = promisify(execFile);

function sessionFile({ lane, as }: { lane: string; as: string }) {
  return join(DIR, "auth", `${lane}--${as}.json`);
}

/** Signs the lane in with its own session, so no lane signs another out; waits out one reload. */
async function signIn({ lane, as, timeout }: { lane: string; as: string; timeout: number }) {
  const file = sessionFile({ lane, as });
  const args = ["auth", as, "--out", file, "--stack", STACK, "--agent"];
  try {
    await runHaven(HAVEN, args);
  } catch (error) {
    if (!/answered 50[234]|could not reach/.test(String(error))) throw error;
    closeGate();
    await backendServes({ timeout });
    await runHaven(HAVEN, args);
  }
  return file;
}

/** Marks a lane signed out when it lands on sign-in; an api 50x closes the reload gate. */
function watchLane({ lane }: { lane: Lane }) {
  const { page, as } = lane;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const path = new URL(frame.url()).pathname;
    if (path.startsWith("/auth/signin")) lane.signedOut = Boolean(as);
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 502 || status > 504) return;
    const { host, pathname } = new URL(response.url());
    if (host === APP.host && pathname.startsWith("/api/")) closeGate();
  });
}

async function laneFor({
  name,
  as,
  timeout,
  stateFile,
}: {
  name: string;
  as: string;
  timeout: number;
  stateFile?: string;
}): Promise<Lane> {
  const existing = lanes.get(name);
  if (existing && !stateFile && (!as || existing.as === as)) return existing;
  if (existing) await closeLane({ name });
  if (lanes.size >= MAX_LANES) {
    throw new Error(
      `the browser already holds ${MAX_LANES} lanes; close one (haven browser close --lane <name>)`,
    );
  }
  // A lane keeps its session across daemons: the stack allows 30 sign-ins per 15 minutes.
  const saved = sessionFile({ lane: name, as });
  let storageState = stateFile;
  if (as && !stateFile)
    storageState = existsSync(saved) ? saved : await signIn({ lane: name, as, timeout });
  const context = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const lane: Lane = { name, as, context, page, signedOut: false };
  watchLane({ lane });
  lanes.set(name, lane);
  return lane;
}

async function closeLane({ name }: { name: string }) {
  const lane = lanes.get(name);
  if (!lane) return;
  lanes.delete(name);
  clearTimeout(lane.idle);
  await lane.context.close();
  if (lanes.size === 0) scheduleExit();
}

let exitTimer: NodeJS.Timeout | undefined;
function scheduleExit() {
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => void shutdown(), IDLE_MS);
}

function touch({ lane }: { lane: Lane }) {
  clearTimeout(exitTimer);
  clearTimeout(lane.idle);
  lane.idle = setTimeout(() => void closeLane({ name: lane.name }), IDLE_MS);
}

/** The app shell mounted (precedent: apps/ui/scripts/smoke-boot.mjs), then the network settles. */
async function settle({
  page,
  waitFor,
  timeout,
}: {
  page: Page;
  waitFor: string;
  timeout: number;
}) {
  await page.waitForFunction(
    () => (document.getElementById("root")?.innerHTML.length ?? 0) > 100,
    undefined,
    {
      timeout,
    },
  );
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) })
    .catch(() => undefined);
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout });
}

/** Visits url (or stays put) and comes back signed in if the app had signed the lane out. */
async function visit({
  lane,
  url,
  waitFor,
  timeout,
}: {
  lane: Lane;
  url: string;
  waitFor: string;
  timeout: number;
}) {
  await backendServes({ timeout });
  const target = url ? new URL(url, APP).toString() : "";
  if (target && new URL(target).host !== APP.host)
    throw new Error(`haven browser only opens this stack (${APP.host})`);
  if (target) await lane.page.goto(target, { waitUntil: "domcontentloaded", timeout });
  if (target || lane.page.url() !== "about:blank")
    await settle({ page: lane.page, waitFor: "", timeout });
  if (lane.signedOut) {
    const back = target || lane.page.url();
    const state = JSON.parse(
      readFileSync(await signIn({ lane: lane.name, as: lane.as, timeout }), "utf8"),
    );
    await lane.context.clearCookies();
    await lane.context.addCookies(state.cookies);
    lane.signedOut = false;
    const again = new URL(back).pathname.startsWith("/auth/signin") ? APP.toString() : back;
    await lane.page.goto(again, { waitUntil: "domcontentloaded", timeout });
    await settle({ page: lane.page, waitFor: "", timeout });
  }
  if (waitFor) await settle({ page: lane.page, waitFor, timeout });
}

type Request = {
  lane?: string;
  as?: string;
  url?: string;
  waitFor?: string;
  timeoutMs?: number;
  expression?: string;
  out?: string;
  ref?: string;
  text?: string;
  key?: string;
  file?: string;
};

type Act = (args: { page: Page; body: Request; timeout: number }) => Promise<unknown>;

/** playwright-cli's verbs; a ref is one an ai-mode snapshot printed (`[ref=e12]`). */
const actions: Record<string, Act> = {
  open: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  goto: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  "state-load": async ({ page }) => ({ url: page.url(), title: await page.title() }),
  snapshot: async ({ page, timeout }) => ({
    url: page.url(),
    title: await page.title(),
    snapshot: await page.ariaSnapshot({ mode: "ai", timeout }),
  }),
  screenshot: async ({ page, body, timeout }) => {
    const file = body.out ?? join(DIR, `${body.lane}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, timeout, animations: "disabled" });
    return { url: page.url(), file };
  },
  click: async ({ page, body, timeout }) => {
    await page.locator(`aria-ref=${body.ref}`).click({ timeout });
    return afterInput({ page, timeout });
  },
  fill: async ({ page, body, timeout }) => {
    await page.locator(`aria-ref=${body.ref}`).fill(body.text ?? "", { timeout });
    return afterInput({ page, timeout });
  },
  select: async ({ page, body, timeout }) => {
    const target = locatorFor({ page, ref: body.ref ?? "" });
    const text = body.text ?? "";
    const native = await target.evaluate((el) => el.tagName === "SELECT", undefined, { timeout });
    if (native) await target.selectOption([{ label: text }], { timeout });
    else {
      await target.click({ timeout });
      await page.getByRole("option", { name: text, exact: true }).first().click({ timeout });
    }
    return afterInput({ page, timeout });
  },
  type: async ({ page, body, timeout }) => {
    await page.keyboard.type(body.text ?? "");
    return afterInput({ page, timeout });
  },
  press: async ({ page, body, timeout }) => {
    await page.keyboard.press(body.key ?? "");
    return afterInput({ page, timeout });
  },
  eval: async ({ page, body }) => ({
    url: page.url(),
    value: await page.evaluate(body.expression ?? "undefined"),
  }),
};

/** A snapshot ref (`e12`, `f1e3`) or, failing that, a CSS selector. */
function locatorFor({ page, ref }: { page: Page; ref: string }) {
  return /^(f\d+)?e\d+$/.test(ref) ? page.locator(`aria-ref=${ref}`) : page.locator(ref).first();
}

/** After input the page's own requests settle (capped), as playwright-cli waits after an action. */
async function afterInput({ page, timeout }: { page: Page; timeout: number }) {
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) })
    .catch(() => undefined);
  return { url: page.url(), title: await page.title() };
}

async function handle({ verb, body }: { verb: string; body: Request }): Promise<unknown> {
  if (verb === "status") return { running: true, pid: process.pid, lanes: [...lanes.keys()] };
  if (verb === "stop") {
    setImmediate(() => void shutdown());
    return { stopped: true };
  }
  const name = body.lane ?? "";
  if (!/^[\w-]+$/.test(name)) throw new Error("--lane must be letters, digits, - or _");
  if (!/^[\w.+@-]*$/.test(body.as ?? "")) throw new Error("--as must be admin or an email");
  if (verb === "close") {
    await closeLane({ name });
    return { closed: name };
  }
  const act = actions[verb];
  if (!act) throw new Error(`unknown verb ${verb}`);
  const timeout = body.timeoutMs ?? 30_000;
  const stateFile = verb === "state-load" ? body.file : undefined;
  const lane = await laneFor({ name, as: body.as ?? "", timeout, stateFile });
  touch({ lane });
  return withSlot({
    run: async () => {
      const blank = lane.page.url() === "about:blank";
      const url = body.url || (blank ? "/" : "");
      await visit({ lane, url, waitFor: body.waitFor ?? "", timeout });
      return act({ page: lane.page, body, timeout });
    },
  });
}

async function readBody({ req }: { req: IncomingMessage }): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Request) : {};
}

function reply({ res, status, body }: { res: ServerResponse; status: number; body: unknown }) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return reply({ res, status: 401, body: { error: "unauthorized" } });
  const verb = (req.url ?? "/").slice(1);
  readBody({ req })
    .then((body) => handle({ verb, body }))
    .then((body) => reply({ res, status: 200, body }))
    .catch((error: unknown) =>
      reply({
        res,
        status: 500,
        body: { error: error instanceof Error ? error.message : String(error) },
      }),
    );
});

async function shutdown() {
  server.close();
  await browser.close().catch(() => undefined);
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
  process.on(signal, () => void shutdown());

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(`${JSON.stringify({ port })}\n`);
  scheduleExit();
});
