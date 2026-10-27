/**
 * `haven browser`'s daemon (tools/thuishaven/cmd/browser.go starts it): one
 * headless shell per machine, one context per stack and lane, commands over
 * loopback HTTP. Waits are page and log events, never sleeps; stdout carries one line.
 */
import { execFile } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Request as PwRequest,
  type Route,
} from "playwright";

import { stampStderr } from "./browser-log.ts";
import {
  consoleLine,
  diffSnapshots,
  netLine,
  pickConsole,
  pickNet,
  pushRing,
  redactBody,
  shortUrl,
  summariseTrace,
  type ConsoleEntry,
  type NetEntry,
  type TraceEvent,
} from "./browser-observe.ts";
import {
  REDACTED,
  dedupe,
  describeElement,
  locatorOf,
  missingQuery,
  queriesOf,
  pushWalk,
  recordLocator,
  settleWalk,
  type LocatorSpec,
  type Query,
  type Script,
  type Step,
  type Walk,
} from "./browser-record.ts";
import { faultBody, routeRule, takeFault, type RouteRule } from "./browser-route.ts";
import { filterSnapshot } from "./browser-snapshot.ts";
import { parseTotp, redactSecrets, totpCode, wrongCode, type Totp } from "./mfa-totp.ts";

stampStderr();

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: haven browser starts this daemon`);
  return value;
};
const TOKEN = env("HAVEN_BROWSER_TOKEN");
const IDLE_MS = Number(process.env.HAVEN_BROWSER_IDLE_MS ?? 5 * 60_000);
const LANE_IDLE_MS = Number(process.env.HAVEN_BROWSER_LANE_IDLE_MS ?? 10 * 60_000);
/** An idle lane's page is closed (its renderer freed) and reopened on the lane's next verb. */
const LANE_UNLOAD_MS = Number(process.env.HAVEN_BROWSER_LANE_UNLOAD_MS ?? 2 * 60_000);
const MAX_LANES = Number(process.env.HAVEN_BROWSER_MAX_LANES ?? 24);
/** haven's browser-memory-mb limit, handed over by the haven that starts this daemon. */
const MAX_RSS_MB = Number(process.env.HAVEN_BROWSER_MAX_RSS_MB ?? 4096);
/** Above this share of the limit idle pages are unloaded, least recently used first. */
const UNLOAD_ABOVE_MB = Math.round(MAX_RSS_MB * 0.75);
const PRESSURE_CHECK_MS = 15_000;
const MAX_BUSY = Number(process.env.HAVEN_BROWSER_MAX_PAGES ?? 6);
const READY_LINE = '"msg":"backend ready"';
const RECYCLING_LINE = '"msg":"backend recycling"';
/** Bumped when a request's shape changes; the CLI restarts or refuses a daemon speaking another. */
const PROTOCOL = 2;
const NET_CAP = 400;
const CONSOLE_CAP = 200;

/** The backend-reload gate: closed by a recycling line or a 50x, opened by the ready line. */
type Gate = { ready: Promise<void>; open?: () => void };
/** One worktree's stack: its app, where its sign-ins and mfa state live, its reload gate. */
type Stack = { slug: string; app: URL; domain: string; dir: string; haven: string; gate: Gate };
type StackBody = { slug?: string; app?: string; appLog?: string; dir?: string; haven?: string };
const stacks = new Map<string, Stack>();

/** The request's stack, registered (its app log watched) the first time it names its app. */
function stackFor({ body }: { body?: StackBody }): Stack {
  const slug = body?.slug ?? "";
  if (!/^[\w.-]+$/.test(slug))
    throw new Error("the request names no stack (haven browser sends it)");
  const known = stacks.get(slug);
  if (known && (!body?.app || known.app.toString() === new URL(body.app).toString())) return known;
  if (!body?.app || !body.dir || !body.haven)
    throw new Error(`stack ${slug} has no lane in this browser yet; open one first`);
  const app = new URL(body.app);
  const domain = app.hostname.split(".").slice(1).join(".");
  const gate: Gate = { ready: Promise.resolve() };
  const stack: Stack = { slug, app, domain, dir: body.dir, haven: body.haven, gate };
  stacks.set(slug, stack);
  watchAppLog({ stack, path: body.appLog ?? "" });
  return stack;
}

/** The app, or another of this stack's services on the same proxy (design-system, mail-room). */
const onThisStack = ({ stack, url }: { stack: Stack; url: URL }) =>
  url.port === stack.app.port && url.hostname.endsWith(`.${stack.domain}`);

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
    // About a quarter less renderer memory on signed-in pages, same load time and pixels.
    "--js-flags=--optimize-for-size",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
  ],
});
/** Set once shutdown closes the browser on purpose, so that disconnect is not a crash. */
let closing = false;
/** The browser tree's RSS at the last measure: all that is known once it is gone. */
let lastTreeMb: number | undefined;
const memoryNote = () => {
  const own = Math.round(process.memoryUsage().rss / 2 ** 20);
  const tree =
    lastTreeMb === undefined ? "not measured" : `${Math.round(lastTreeMb)} MB at the last measure`;
  return `daemon RSS ${own} MB, browser tree ${tree}`;
};
browser.on("disconnected", () => {
  if (closing) return;
  console.error(`browser disconnected (crashed or killed), exiting: ${memoryNote()}`);
  process.exit(1);
});
process.on("exit", (code) => console.error(`daemon exited with code ${code}; ${memoryNote()}`));

type Lane = {
  /** `<stack>/<lane>`: two stacks may both have a lane called qa-1. */
  key: string;
  stack: Stack;
  name: string;
  as: string;
  context: BrowserContext;
  page: Page;
  signedOut: boolean;
  idle?: NodeJS.Timeout;
  /** Set while the page is closed for idling: the url it is reopened at. */
  unload?: NodeJS.Timeout;
  unloadedFrom?: string;
  /** Verbs running on the lane; its page is never unloaded under one. */
  busy: number;
  /** App queries seen since the last action began; `recording` keeps the steps so far. */
  seen: Query[];
  inflight: number;
  recording?: Script;
  /** Every action the lane took, capped: `record save` turns it into a script. */
  walk: Walk;
  /** The CDP session with the lane's virtual authenticators (`browser mfa`); closing drops them. */
  webauthn?: CDPSession;
  authenticators: Map<string, { kind: string; userVerified: boolean }>;
  /** `haven browser route`: requests answered with a fault, by URL glob. */
  routes: Map<string, RouteRule>;
  /** `haven browser network|console`: the newest requests and messages, and each read's cursor. */
  net: NetEntry[];
  netSeq: number;
  netCursor: number;
  netRequests: Map<number, PwRequest>;
  console: ConsoleEntry[];
  consoleSeq: number;
  consoleCursor: number;
  /** `--lean`: images, fonts and media blocked, animations off. */
  lean: boolean;
  leanRoute: (route: Route) => Promise<void>;
  /** When the lane last ran a verb: memory pressure unloads the oldest first. */
  usedAt: number;
};
const lanes = new Map<string, Lane>();
const netEntries = new WeakMap<PwRequest, NetEntry>();
/** Lane keys closed for idling, told once on their next command. */
const idled = new Set<string>();

/** Resident memory of this daemon and every browser process under it, in MB. */
async function treeRssMb(): Promise<number> {
  const { stdout } = await runHaven("ps", ["-A", "-o", "pid=,ppid=,rss="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number));
  const inTree = new Set([process.pid]);
  let kb = 0;
  for (let grown = true; grown;) {
    grown = false;
    for (const [pid = 0, ppid = 0] of rows) {
      if (inTree.has(pid) || !inTree.has(ppid)) continue;
      inTree.add(pid);
      grown = true;
    }
  }
  for (const [pid = 0, , rss = 0] of rows) if (inTree.has(pid)) kb += rss;
  lastTreeMb = kb / 1024;
  return lastTreeMb;
}

function closeGate({ stack }: { stack: Stack }) {
  const { gate } = stack;
  if (gate.open) return;
  gate.ready = new Promise((resolve) => {
    gate.open = () => {
      gate.open = undefined;
      resolve();
    };
  });
}

function watchAppLog({ stack, path }: { stack: Stack; path: string }) {
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
    if (text.includes(RECYCLING_LINE)) closeGate({ stack });
    if (text.includes(READY_LINE)) stack.gate.open?.();
  });
}

/** Resolves once the backend serves; a reload that never says ready fails at the timeout. */
async function backendServes({ stack, timeout }: { stack: Stack; timeout: number }) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`the backend did not say ready within ${timeout} ms (haven logs app)`)),
      timeout,
    );
  });
  try {
    await Promise.race([stack.gate.ready, late]);
  } catch (error) {
    stack.gate.open?.(); // a missed ready line must not hold every later command
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

function sessionFile({ stack, lane, as }: { stack: Stack; lane: string; as: string }) {
  return join(stack.dir, "auth", `${lane}--${as}.json`);
}

/** Signs the lane in with its own session, so no lane signs another out; waits out one reload. */
async function signIn({
  stack,
  lane,
  as,
  timeout,
}: {
  stack: Stack;
  lane: string;
  as: string;
  timeout: number;
}) {
  const file = sessionFile({ stack, lane, as });
  const args = ["browser", "login", "--as", as, "--out", file, "--stack", stack.slug, "--agent"];
  try {
    await runHaven(stack.haven, args);
  } catch (error) {
    if (!/answered 50[234]|could not reach/.test(String(error))) throw error;
    closeGate({ stack });
    await backendServes({ stack, timeout });
    await runHaven(stack.haven, args);
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
  const appHost = lane.stack.app.host;
  watchTraffic({ lane });
  page.on("response", (response) => {
    const status = response.status();
    const entry = netEntries.get(response.request());
    if (entry) entry.status = status;
    const type = response.request().resourceType();
    if (type === "fetch" || type === "xhr")
      lane.seen.push(
        ...queriesOf({
          method: response.request().method(),
          url: response.url(),
          status,
          appHost,
        }),
      );
    if (status < 502 || status > 504) return;
    const { host, pathname } = new URL(response.url());
    if (host === appHost && pathname.startsWith("/api/")) closeGate({ stack: lane.stack });
  });
}

/** Feeds `network` and `console`: every request with its status and time, every message. */
function watchTraffic({ lane }: { lane: Lane }) {
  const { page } = lane;
  const appHost = lane.stack.app.host;
  const done = ({ request, failed }: { request: PwRequest; failed?: string }) => {
    lane.inflight = Math.max(0, lane.inflight - 1);
    const entry = netEntries.get(request);
    if (!entry) return;
    entry.ms = Date.now() - entry.start;
    if (failed) entry.failed = failed;
  };
  page.on("request", (request) => {
    lane.inflight += 1;
    lane.netSeq += 1;
    const entry: NetEntry = {
      id: lane.netSeq,
      method: request.method(),
      url: request.url(),
      type: request.resourceType(),
      start: Date.now(),
    };
    netEntries.set(request, entry);
    pushRing({ list: lane.net, item: entry, cap: NET_CAP });
    lane.netRequests.set(entry.id, request);
    lane.netRequests.delete(entry.id - NET_CAP);
  });
  page.on("requestfinished", (request) => done({ request }));
  page.on("requestfailed", (request) =>
    done({ request, failed: request.failure()?.errorText ?? "failed" }),
  );
  page.on("console", (message) => {
    lane.consoleSeq += 1;
    const { url, lineNumber } = message.location();
    const where = url ? `${shortUrl({ url, appHost })}:${lineNumber}` : undefined;
    const item = { id: lane.consoleSeq, level: message.type(), text: message.text(), where };
    pushRing({ list: lane.console, item, cap: CONSOLE_CAP });
  });
  page.on("pageerror", (error) => {
    lane.consoleSeq += 1;
    const item = { id: lane.consoleSeq, level: "error", text: `uncaught ${error.message}` };
    pushRing({ list: lane.console, item, cap: CONSOLE_CAP });
  });
  page.on("domcontentloaded", () => {
    if (lane.lean)
      void page.evaluate(styleLean, { on: true, css: LEAN_STYLE }).catch(() => undefined);
  });
}

async function laneFor({
  stack,
  name,
  as,
  timeout,
  stateFile,
}: {
  stack: Stack;
  name: string;
  as: string;
  timeout: number;
  stateFile?: string;
}): Promise<Lane> {
  const key = `${stack.slug}/${name}`;
  const existing = lanes.get(key);
  if (existing && !stateFile && (!as || existing.as === as)) return existing;
  if (existing) await closeLane({ key });
  if (lanes.size >= MAX_LANES) {
    throw new Error(
      `the browser already holds ${MAX_LANES} lanes; close one (haven browser close --lane <name>)`,
    );
  }
  const rss = await relieveMemory({ aboveMb: UNLOAD_ABOVE_MB });
  if (rss > MAX_RSS_MB) {
    throw new Error(
      `the browser uses ${Math.round(rss)} MB, over its ${MAX_RSS_MB} MB limit (browser-memory-mb) after unloading idle pages: refusing a new lane; close one (haven browser close --lane <name>) or raise it (haven machine limits set browser-memory-mb <MB>)`,
    );
  }
  // A lane keeps its session across daemons: the stack allows 30 sign-ins per 15 minutes.
  const saved = sessionFile({ stack, lane: name, as });
  let storageState = stateFile;
  if (as && !stateFile)
    storageState = existsSync(saved) ? saved : await signIn({ stack, lane: name, as, timeout });
  const context = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const lane: Lane = {
    key,
    stack,
    name,
    as,
    context,
    page,
    signedOut: false,
    seen: [],
    walk: { script: { version: 1, steps: [] } },
    inflight: 0,
    authenticators: new Map(),
    routes: new Map(),
    net: [],
    netSeq: 0,
    netCursor: 0,
    netRequests: new Map(),
    console: [],
    consoleSeq: 0,
    consoleCursor: 0,
    lean: false,
    leanRoute,
    busy: 0,
    usedAt: Date.now(),
  };
  watchLane({ lane });
  lanes.set(key, lane);
  return lane;
}

async function closeLane({ key }: { key: string }) {
  const lane = lanes.get(key);
  if (!lane) return;
  lanes.delete(key);
  clearTimeout(lane.idle);
  clearTimeout(lane.unload);
  if (profiling?.key === key) {
    profiling = undefined;
    await browser.stopTracing().catch(() => undefined);
  }
  await lane.context.close();
  if (lanes.size === 0) scheduleExit();
}

let exitTimer: NodeJS.Timeout | undefined;
function scheduleExit() {
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => void shutdown({ why: `idle ${IDLE_MS} ms with no lane` }), IDLE_MS);
}

function touch({ lane }: { lane: Lane }) {
  lane.usedAt = Date.now();
  clearTimeout(exitTimer);
  clearTimeout(lane.idle);
  lane.idle = setTimeout(() => {
    idled.add(lane.key);
    console.error(`lane ${lane.key} closed after idling ${LANE_IDLE_MS} ms`);
    void closeLane({ key: lane.key });
  }, LANE_IDLE_MS);
  clearTimeout(lane.unload);
  if (LANE_UNLOAD_MS > 0) lane.unload = setTimeout(() => void unloadPage({ lane }), LANE_UNLOAD_MS);
}

/** Closes an idle lane's page, keeping its context (cookies, storage, routes, lean). */
async function unloadPage({ lane, why }: { lane: Lane; why?: string }) {
  if (lane.busy || lane.unloadedFrom || lane.webauthn || profiling?.key === lane.key) return;
  if (lanes.get(lane.key) !== lane) return;
  lane.unloadedFrom = lane.page.url();
  console.error(`lane ${lane.key} page unloaded ${why ?? `after idling ${LANE_UNLOAD_MS} ms`}`);
  await lane.page.close().catch(() => undefined);
}

/** Unloads idle pages, least recently used first, until the tree is at or under aboveMb. */
async function relieveMemory({ aboveMb }: { aboveMb: number }): Promise<number> {
  let rss = await treeRssMb();
  const oldestFirst = [...lanes.values()].toSorted((a, b) => a.usedAt - b.usedAt);
  for (const lane of oldestFirst) {
    if (rss <= aboveMb) break;
    if (lane.busy || lane.unloadedFrom) continue;
    await unloadPage({
      lane,
      why: `under memory pressure (${Math.round(rss)} MB, limit ${MAX_RSS_MB} MB)`,
    });
    rss = await treeRssMb();
  }
  return rss;
}

let relieving = false;
const pressureTimer = setInterval(() => {
  if (relieving || lanes.size === 0) return;
  relieving = true;
  void relieveMemory({ aboveMb: UNLOAD_ABOVE_MB })
    .catch(() => undefined)
    .finally(() => (relieving = false));
}, PRESSURE_CHECK_MS);
pressureTimer.unref();

/** A new page for an unloaded lane, back at the url it was on. */
async function reopenPage({ lane, timeout }: { lane: Lane; timeout: number }) {
  const from = lane.unloadedFrom;
  if (from === undefined) return;
  lane.page = await lane.context.newPage();
  lane.unloadedFrom = undefined;
  lane.inflight = 0;
  watchLane({ lane });
  if (from === "about:blank") return;
  await lane.page.goto(from, { waitUntil: "domcontentloaded", timeout });
  await settle({ page: lane.page, waitFor: "", timeout }).catch(() => undefined);
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
  const app = await page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      if (!root) return document.readyState === "complete" ? "absent" : false;
      return root.innerHTML.length > 100 && "mounted";
    },
    undefined,
    { timeout },
  );
  if ((await app.jsonValue()) === "absent")
    throw new Error(
      `${page.url()} is not the app (a proxy or error page); goto a path again once the stack serves`,
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
  const { stack } = lane;
  await backendServes({ stack, timeout });
  const target = url ? new URL(url, stack.app).toString() : "";
  if (target && !onThisStack({ stack, url: new URL(target) }))
    throw new Error(`haven browser only opens this stack (*.${stack.domain}:${stack.app.port})`);
  if (target) await lane.page.goto(target, { waitUntil: "domcontentloaded", timeout });
  if (target || lane.page.url() !== "about:blank")
    await settle({ page: lane.page, waitFor: "", timeout });
  if (lane.signedOut) {
    const back = target || lane.page.url();
    const state = JSON.parse(
      readFileSync(await signIn({ stack, lane: lane.name, as: lane.as, timeout }), "utf8"),
    );
    await lane.context.clearCookies();
    await lane.context.addCookies(state.cookies);
    lane.signedOut = false;
    const again = new URL(back).pathname.startsWith("/auth/signin") ? stack.app.toString() : back;
    await lane.page.goto(again, { waitUntil: "domcontentloaded", timeout });
    await settle({ page: lane.page, waitFor: "", timeout });
  }
  if (waitFor) await settle({ page: lane.page, waitFor, timeout });
}

type Request = {
  stack?: StackBody;
  lane?: string;
  as?: string;
  url?: string;
  waitFor?: string;
  timeoutMs?: number;
  expression?: string;
  out?: string;
  /** click: save the download this click starts to this absolute path. */
  downloadTo?: string;
  ref?: string;
  text?: string;
  key?: string;
  file?: string;
  files?: string[];
  locator?: LocatorSpec;
  script?: Script;
  targetRef?: string;
  target?: LocatorSpec;
  by?: { dx: number; dy: number };
  grep?: string;
  depth?: number;
  maxChars?: number;
  kind?: string;
  /** CDP's VirtualAuthenticatorOptions, built by haven (mfa.go). */
  options?: {
    protocol: "ctap2" | "u2f";
    transport: "usb" | "nfc" | "ble" | "internal";
    hasResidentKey: boolean;
    hasUserVerification: boolean;
    isUserVerified: boolean;
    automaticPresenceSimulation: boolean;
  };
  authenticatorId?: string;
  verified?: boolean;
  /** `haven browser mfa totp fill --wrong`: type a code no window accepts. */
  wrong?: boolean;
  /** `haven browser route`: the URL glob, the status to answer and how many times. */
  pattern?: string;
  status?: number;
  times?: number;
  /** Actions: skip the page diff and print only url and title. */
  full?: boolean;
  /** Any verb: turn lean on for the lane; `lean` takes `mode` on or off. */
  lean?: boolean;
  mode?: string;
  /** `network` and `console`: only what arrived since the lane's last read of that kind. */
  sinceLast?: boolean;
  failed?: boolean;
  all?: boolean;
  level?: string;
  /** `network show`: the request's id. */
  id?: number;
  /** `stop`: every stack's lanes and the daemon, not only this stack's lanes. */
  everything?: boolean;
};

const MEDIA_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Click and save the download it starts; the media type comes from the file name's extension. */
async function clickDownload({
  page,
  body,
  timeout,
}: {
  page: Page;
  body: Request;
  timeout: number;
}) {
  const file = body.downloadTo ?? "";
  const started = page.waitForEvent("download", { timeout });
  await targetOf({ page, body }).click({ timeout });
  const download = await started;
  mkdirSync(dirname(file), { recursive: true });
  await download.saveAs(file);
  const name = download.suggestedFilename();
  return {
    file,
    name,
    size: statSync(file).size,
    mediaType: MEDIA_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream",
  };
}

type Act = (args: {
  lane: Lane;
  page: Page;
  body: Request;
  timeout: number;
}) => Promise<Record<string, unknown>>;

/** playwright-cli's verbs; a ref is one an ai-mode snapshot printed (`[ref=e12]`). */
const actions: Record<string, Act> = {
  open: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  goto: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  "state-load": async ({ page }) => ({ url: page.url(), title: await page.title() }),
  snapshot: async ({ lane, page, body, timeout }) => ({
    url: page.url(),
    title: await page.title(),
    snapshot: filterSnapshot({
      text: redactSecrets({
        text: await page.ariaSnapshot({ mode: "ai", timeout }),
        secrets: await shownSecrets({ page, lane }),
      }),
      grep: body.grep,
      depth: body.depth,
      maxChars: body.maxChars,
    }),
  }),
  screenshot: async ({ lane, page, body, timeout }) => {
    const file = body.out ?? join(lane.stack.dir, `${lane.name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    const mask = (await shownSecrets({ page })).length
      ? [page.locator(SECRET_SELECTORS), page.getByText(/^([A-Z2-7]{4} ){3,}[A-Z2-7]{1,4}$/)]
      : [];
    await page.screenshot({ path: file, timeout, animations: "disabled", mask });
    return { url: page.url(), file };
  },
  click: async ({ page, body, timeout }) => {
    if (body.downloadTo) return clickDownload({ page, body, timeout });
    await targetOf({ page, body }).click({ timeout });
    return afterInput({ page, timeout });
  },
  hover: async ({ page, body, timeout }) => {
    await targetOf({ page, body }).hover({ timeout });
    return afterInput({ page, timeout });
  },
  upload: async ({ page, body, timeout }) => {
    const target = targetOf({ page, body });
    const files = body.files ?? [];
    const isInput = await target.evaluate(
      (el) => el instanceof HTMLInputElement && el.type === "file",
      undefined,
      { timeout },
    );
    if (isInput) await target.setInputFiles(files, { timeout });
    else {
      const chooser = page.waitForEvent("filechooser", { timeout });
      await target.click({ timeout });
      await (await chooser).setFiles(files);
    }
    return afterInput({ page, timeout });
  },
  drag: async ({ page, body, timeout }) => {
    await dragBetween({ page, body, timeout });
    return afterInput({ page, timeout });
  },
  fill: async ({ page, body, timeout }) => {
    await targetOf({ page, body }).fill(body.text ?? "", { timeout });
    return afterInput({ page, timeout });
  },
  select: async ({ page, body, timeout }) => {
    const target = targetOf({ page, body });
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
  eval: async ({ lane, page, body }) => {
    const value: unknown = await page.evaluate(body.expression ?? "undefined");
    const secrets = await shownSecrets({ page, lane });
    const text = JSON.stringify(value);
    return {
      url: page.url(),
      value: text === undefined ? value : JSON.parse(redactSecrets({ text, secrets })),
    };
  },
};

/** The app's TOTP setup: the scannable code and the setup-key field (two-step-setup-panel.tsx). */
const SECRET_SELECTORS =
  '[data-testid="two-factor-scannable-code"], [data-testid="two-factor-shared-secret"]';

/** What could be a TOTP secret on the page: otpauth:// URIs anywhere, then the setup key. */
function totpOnPage(): string[] {
  const found = [...document.documentElement.outerHTML.matchAll(/otpauth:\/\/[^\s"'<>]+/g)].map(
    (match) => match[0].replaceAll("&amp;", "&"),
  );
  for (const field of document.querySelectorAll("input, textarea"))
    if ((field as HTMLInputElement).value.startsWith("otpauth://"))
      found.push((field as HTMLInputElement).value);
  const key = document.querySelector<HTMLInputElement>(
    '[data-testid="two-factor-shared-secret"] input',
  );
  if (key?.value) found.push(key.value);
  return found;
}

/** Every secret a snapshot, eval or screenshot hides: on the page now, or enrolled on the lane. */
async function shownSecrets({ page, lane }: { page: Page; lane?: Lane }) {
  const raw = await page.evaluate(totpOnPage).catch(() => [] as string[]);
  const secrets = raw.flatMap((text) => parseTotp({ raw: text })?.secret ?? []);
  const stored = lane ? readTotp({ lane }) : undefined;
  return stored ? [...secrets, stored.secret] : secrets;
}

/** Where a lane's TOTP secret lives: the daemon's own state, mode 600, never echoed. */
const totpFile = ({ lane }: { lane: Lane }) =>
  join(lane.stack.dir, "mfa", `${lane.name}.totp.json`);

function readTotp({ lane }: { lane: Lane }): Totp | undefined {
  const file = totpFile({ lane });
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Totp) : undefined;
}

/** A snapshot ref (`e12`, `f1e3`) or, failing that, a CSS selector. */
function locatorFor({ page, ref }: { page: Page; ref: string }) {
  return /^(f\d+)?e\d+$/.test(ref) ? page.locator(`aria-ref=${ref}`) : page.locator(ref).first();
}

/** A recorded locator when the step has one (replay), else the caller's ref or selector. */
function targetOf({ page, body }: { page: Page; body: Request }) {
  return body.locator
    ? locatorOf({ page, spec: body.locator })
    : locatorFor({ page, ref: body.ref ?? "" });
}

/** The drop element of a drag: a recorded locator, else the caller's second ref or selector. */
function dropTargetOf({ page, body }: { page: Page; body: Request }) {
  if (body.target) return locatorOf({ page, spec: body.target });
  return body.targetRef ? locatorFor({ page, ref: body.targetRef }) : undefined;
}

/** Real mouse moves in steps, since React Flow and sortable lists ignore a jump from down to up. */
async function dragBetween({
  page,
  body,
  timeout,
}: {
  page: Page;
  body: Request;
  timeout: number;
}) {
  const source = targetOf({ page, body });
  const drop = dropTargetOf({ page, body });
  if (!drop && !body.by) throw new Error("drag needs a target ref or --by dx,dy");
  await source.scrollIntoViewIfNeeded({ timeout });
  const from = await source.boundingBox({ timeout });
  if (!from) throw new Error("the drag source has no box on the page");
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const to = drop ? await drop.boundingBox({ timeout }) : undefined;
  if (drop && !to) throw new Error("the drag target has no box on the page");
  const end = to
    ? { x: to.x + to.width / 2, y: to.y + to.height / 2 }
    : { x: start.x + (body.by?.dx ?? 0), y: start.y + (body.by?.dy ?? 0) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 5, start.y + 5, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

const pathOf = (url: string) => new URL(url).pathname;
/** The page's path, or "/" before the lane's first page. */
const pagePath = ({ page }: { page: Page }) =>
  page.url() === "about:blank" ? "/" : pathOf(page.url());

/** The step a recorded verb stands for, described before the action changes the page. */
async function describeStep({
  page,
  app,
  verb,
  body,
  url,
  timeout,
}: {
  page: Page;
  app: URL;
  verb: string;
  body: Request;
  url: string;
  timeout?: number;
}): Promise<Omit<Step, "expect"> | undefined> {
  if ((verb === "goto" || verb === "open") && url) {
    const target = new URL(url, app);
    return { verb: "goto", url: target.pathname + target.search };
  }
  if (verb === "press") return { verb: "press", key: body.key };
  if (verb === "type") {
    const focus = await page
      .locator(":focus")
      .evaluate(describeElement, undefined, { timeout })
      .catch(() => undefined);
    return { verb: "type", text: focus?.secret ? REDACTED : body.text };
  }
  if (verb === "drag") return describeDrag({ page, body, timeout });
  if (verb === "click" || verb === "hover" || verb === "fill" || verb === "select")
    return describeTarget({ page, verb, body, timeout });
  return undefined;
}

async function describeDrag({
  page,
  body,
  timeout,
}: {
  page: Page;
  body: Request;
  timeout?: number;
}): Promise<Omit<Step, "expect">> {
  const { spec } = await recordLocator({ page, target: targetOf({ page, body }), timeout });
  const drop = dropTargetOf({ page, body });
  const target = drop && (await recordLocator({ page, target: drop, timeout })).spec;
  return {
    verb: "drag",
    locator: spec,
    ...(target && { target }),
    ...(body.by && { by: body.by }),
  };
}

async function describeTarget({
  page,
  verb,
  body,
  timeout,
}: {
  page: Page;
  verb: "click" | "hover" | "fill" | "select";
  body: Request;
  timeout?: number;
}): Promise<Omit<Step, "expect">> {
  const { spec, described } = await recordLocator({
    page,
    target: targetOf({ page, body }),
    timeout,
  });
  return {
    verb,
    locator: spec,
    ...(verb !== "click" && verb !== "hover" && { text: described.secret ? REDACTED : body.text }),
    ...(verb === "select" && { native: described.tag === "select" }),
  };
}

/** Runs one verb on the lane's page, appending its step to the walk and to a recording. */
async function perform({
  lane,
  verb,
  body,
  timeout,
  observe = false,
}: {
  lane: Lane;
  verb: string;
  body: Request;
  timeout: number;
  observe?: boolean;
}) {
  const act = actions[verb];
  if (!act) throw new Error(`unknown verb ${verb}`);
  const walking = !observe;
  if (walking) settleWalk({ walk: lane.walk, url: pagePath({ page: lane.page }) });
  lane.seen = [];
  const diffed = DIFFED.has(verb) && !observe && !body.full && !body.downloadTo;
  const marks = { net: lane.netSeq, console: lane.consoleSeq };
  const before = diffed ? await ariaText({ lane, timeout }) : "";
  const blank = lane.page.url() === "about:blank";
  const url = body.url || (blank ? "/" : "");
  await visit({ lane, url, waitFor: body.waitFor ?? "", timeout });
  const describing = { page: lane.page, app: lane.stack.app, verb, body, url };
  const step = await stepOf({ lane, describing, walking });
  const result = await act({ lane, page: lane.page, body, timeout });
  if (observe || lane.recording) await quiet({ lane, timeout });
  if (step) keepStep({ lane, step, walking });
  if (!diffed) return result;
  return { ...result, ...(await changesSince({ lane, before, marks, timeout })) };
}

/** The step an action stands for: required while recording, best effort for the walk. */
async function stepOf({
  lane,
  describing,
  walking,
}: {
  lane: Lane;
  describing: Parameters<typeof describeStep>[0];
  walking: boolean;
}) {
  if (lane.recording) return describeStep(describing);
  if (!walking) return undefined;
  return describeStep({ ...describing, timeout: WALK_DESCRIBE_MS }).catch(() => undefined);
}

/** Adds a done action's step to the recording (settled now) and to the walk (settled later). */
function keepStep({
  lane,
  step,
  walking,
}: {
  lane: Lane;
  step: Omit<Step, "expect">;
  walking: boolean;
}) {
  lane.recording?.steps.push({
    ...step,
    expect: { url: pathOf(lane.page.url()), queries: dedupe(lane.seen) },
  });
  if (!walking) return;
  pushWalk({
    walk: lane.walk,
    step: { ...step, expect: { url: pagePath({ page: lane.page }), queries: [] } },
    seen: lane.seen,
  });
}

/** The walk describes a step only when its element is already there: the action reports a miss. */
const WALK_DESCRIBE_MS = 500;

/** The verbs whose answer is what they changed: the page diff, new requests, new errors. */
const DIFFED = new Set([
  "open",
  "goto",
  "click",
  "hover",
  "drag",
  "upload",
  "fill",
  "select",
  "type",
  "press",
]);

/** The lane's ai-mode snapshot with shown secrets hidden; empty when the page will not answer. */
async function ariaText({ lane, timeout }: { lane: Lane; timeout: number }) {
  try {
    const text = await lane.page.ariaSnapshot({ mode: "ai", timeout: Math.min(timeout, 5_000) });
    return redactSecrets({ text, secrets: await shownSecrets({ page: lane.page, lane }) });
  } catch {
    return "";
  }
}

/** What an action did: the tree diff, its requests and the console errors it raised. */
async function changesSince({
  lane,
  before,
  marks,
  timeout,
}: {
  lane: Lane;
  before: string;
  marks: { net: number; console: number };
  timeout: number;
}) {
  const after = await ariaText({ lane, timeout });
  const appHost = lane.stack.app.host;
  const requests = pickNet({ entries: lane.net, after: marks.net });
  const errors = pickConsole({ entries: lane.console, after: marks.console, level: "error" });
  return {
    changes: diffSnapshots({ before, after }),
    requests: requests.slice(-15).map((entry) => netLine({ entry, appHost })),
    errors: errors.slice(-10).map((entry) => consoleLine({ entry })),
  };
}

/** Resolves once no request has been in flight for 150 ms (capped): a step's queries are seen. */
async function quiet({ lane, timeout }: { lane: Lane; timeout: number }) {
  const until = Date.now() + Math.min(timeout, 5_000);
  for (let calm = 0; calm < 150 && Date.now() < until;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    calm = lane.inflight === 0 ? calm + 50 : 0;
  }
}

const describe = (step: Step) =>
  `${step.verb} ${step.url ?? step.key ?? step.locator?.name ?? step.locator?.value ?? ""}`.trim();

/** Replays a script; the first step whose action, URL or recorded queries differ ends it. */
async function replay({ lane, script, timeout }: { lane: Lane; script: Script; timeout: number }) {
  if (script.startUrl)
    await perform({
      lane,
      verb: "goto",
      body: { url: script.startUrl, full: true },
      timeout,
      observe: true,
    });
  for (const [index, step] of script.steps.entries()) {
    const diverged = (expected: string, got: string) => ({
      ok: false,
      steps: script.steps.length,
      divergence: { step: index + 1, action: describe(step), expected, got },
    });
    if (step.text === REDACTED)
      return diverged("a value", `${REDACTED}: edit the script to supply this secret`);
    try {
      await perform({
        lane,
        verb: step.verb,
        body: { ...step, timeoutMs: timeout },
        timeout,
        observe: true,
      });
    } catch (error) {
      return diverged("the step to run", error instanceof Error ? error.message : String(error));
    }
    const url = pathOf(lane.page.url());
    if (url !== step.expect.url) return diverged(`url ${step.expect.url}`, `url ${url}`);
    const missing = missingQuery({ expected: step.expect.queries, got: lane.seen });
    if (missing)
      return diverged(
        `${missing.method} ${missing.path} ${missing.status}`,
        lane.seen.map((q) => `${q.method} ${q.path} ${q.status}`).join(", ") || "no queries",
      );
  }
  return { ok: true, steps: script.steps.length };
}

/** After input the page's own requests settle (capped), as playwright-cli waits after an action. */
async function afterInput({ page, timeout }: { page: Page; timeout: number }) {
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) })
    .catch(() => undefined);
  return { url: page.url(), title: await page.title() };
}

async function recordCommand({
  lane,
  verb,
  body,
  timeout,
}: {
  lane: Lane;
  verb: string;
  body: Request;
  timeout: number;
}) {
  if (verb === "record-start") {
    const here = lane.page.url();
    const start = here === "about:blank" ? undefined : new URL(here);
    lane.recording = {
      version: 1,
      ...(start && { startUrl: start.pathname + start.search }),
      steps: [],
    };
    return { recording: lane.name };
  }
  if (verb === "record-stop") {
    if (!lane.recording) throw new Error(`lane ${lane.name} is not recording (record start first)`);
    const script = lane.recording;
    lane.recording = undefined;
    return { script };
  }
  if (verb === "record-save") {
    await quiet({ lane, timeout });
    settleWalk({ walk: lane.walk, url: pagePath({ page: lane.page }) });
    if (lane.walk.script.steps.length === 0)
      throw new Error(`lane ${lane.name} has taken no action to save yet`);
    return { script: structuredClone(lane.walk.script) };
  }
  if (verb === "replay") {
    if (!body.script) throw new Error("replay needs a script");
    const script = body.script;
    return withSlot({ run: () => replay({ lane, script, timeout }) });
  }
  throw new Error(`unknown verb ${verb}`);
}

/** `haven browser route`: fault, list or lift the lane's routed requests (context routes). */
async function routeCommand({ lane, verb, body }: { lane: Lane; verb: string; body: Request }) {
  if (verb === "route-add") {
    const rule = routeRule({ pattern: body.pattern ?? "", status: body.status, times: body.times });
    if (lane.routes.has(rule.pattern)) await lane.context.unroute(rule.pattern);
    lane.routes.set(rule.pattern, rule);
    await lane.context.route(rule.pattern, async (route) => {
      if (!takeFault({ rule })) return route.continue();
      return route.fulfill({
        status: rule.status,
        contentType: "application/json",
        body: faultBody({ rule }),
      });
    });
    return { routed: rule.pattern, status: rule.status, times: rule.times ?? null };
  }
  if (verb === "route-off") {
    const patterns = body.pattern ? [body.pattern] : [...lane.routes.keys()];
    for (const pattern of patterns) {
      if (!lane.routes.delete(pattern))
        throw new Error(
          `lane ${lane.name} routes nothing for ${pattern} (haven browser route list)`,
        );
      await lane.context.unroute(pattern);
    }
    return { lifted: patterns };
  }
  if (verb === "route-list") {
    return {
      routes: [...lane.routes.values()].map(({ pattern, status, times, hits }) => ({
        pattern,
        status,
        times: times ?? null,
        hits,
      })),
    };
  }
  throw new Error(`unknown verb ${verb}`);
}

/** `haven browser mfa`: virtual WebAuthn authenticators and TOTP codes on the lane's page. */
async function mfaCommand({
  lane,
  verb,
  body,
  timeout,
}: {
  lane: Lane;
  verb: string;
  body: Request;
  timeout: number;
}) {
  if (verb === "mfa-totp-enroll") return totpEnroll({ lane, body, timeout });
  if (verb === "mfa-totp-fill") return withSlot({ run: () => totpFill({ lane, body, timeout }) });
  if (!lane.webauthn) {
    lane.webauthn = await lane.context.newCDPSession(lane.page);
    await lane.webauthn.send("WebAuthn.enable");
  }
  const session = lane.webauthn;
  if (verb === "mfa-add") {
    if (!body.options) throw new Error("mfa add needs options");
    const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
      options: body.options,
    });
    const userVerified = body.options.isUserVerified;
    lane.authenticators.set(authenticatorId, { kind: body.kind ?? "passkey", userVerified });
    return { authenticatorId };
  }
  if (verb === "mfa-list") {
    const authenticators = [];
    for (const [id, about] of lane.authenticators) {
      const { credentials } = await session.send("WebAuthn.getCredentials", {
        authenticatorId: id,
      });
      // Never the private key: only what identifies a credential.
      const listed = credentials.map(
        ({ credentialId, rpId, userHandle, signCount, isResidentCredential }) => ({
          credentialId,
          rpId,
          userHandle,
          signCount,
          isResidentCredential,
        }),
      );
      authenticators.push({ id, ...about, credentials: listed });
    }
    return { authenticators };
  }
  const authenticatorId = body.authenticatorId ?? "";
  const about = lane.authenticators.get(authenticatorId);
  if (!about)
    throw new Error(
      `lane ${lane.name} has no authenticator ${authenticatorId} (haven browser mfa list)`,
    );
  if (verb === "mfa-remove") {
    await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    lane.authenticators.delete(authenticatorId);
    return { removed: authenticatorId };
  }
  if (verb === "mfa-uv") {
    const isUserVerified = body.verified === true;
    await session.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified });
    about.userVerified = isUserVerified;
    return { authenticatorId, userVerified: isUserVerified };
  }
  throw new Error(`unknown verb ${verb}`);
}

/** Reads the secret off the setup page (a ref, else totpOnPage) into the lane's state. */
async function totpEnroll({ lane, body, timeout }: { lane: Lane; body: Request; timeout: number }) {
  const raw = body.ref
    ? [
        await targetOf({ page: lane.page, body }).evaluate(
          (el) =>
            (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
              ? el.value
              : el.querySelector("input")?.value) ||
            el.getAttribute("href") ||
            el.textContent ||
            "",
          undefined,
          { timeout },
        ),
      ]
    : await lane.page.evaluate(totpOnPage);
  const totp = raw.map((text) => parseTotp({ raw: text })).find(Boolean);
  if (!totp)
    throw new Error(
      "no TOTP secret on this page: open the two-step setup first, or name the ref that shows the key",
    );
  const file = totpFile({ lane });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(totp), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { enrolled: lane.name, digits: totp.digits, period: totp.period };
}

/** Types the current code (or, with --wrong, one no window accepts) without returning it. */
async function totpFill({ lane, body, timeout }: { lane: Lane; body: Request; timeout: number }) {
  const totp = readTotp({ lane });
  if (!totp)
    throw new Error(`lane ${lane.name} has no TOTP secret (haven browser mfa totp enroll)`);
  const code = body.wrong
    ? wrongCode({ totp, now: Date.now() })
    : totpCode({ totp, now: Date.now() });
  try {
    await targetOf({ page: lane.page, body }).fill(code, { timeout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replaceAll(code, "***"));
  }
  await afterInput({ page: lane.page, timeout });
  return { filled: lane.name, wrong: body.wrong === true };
}

/** `status`: the machine's browser, with this stack's lanes by name and every stack's by key. */
async function status({ body }: { body: Request }) {
  const slug = body.stack?.slug;
  const all = [...lanes.values()];
  const mine = slug ? all.filter((lane) => lane.stack.slug === slug) : all;
  return {
    running: true,
    pid: process.pid,
    protocol: PROTOCOL,
    memoryMb: Math.round(await treeRssMb()),
    limitMb: MAX_RSS_MB,
    unloadAboveMb: UNLOAD_ABOVE_MB,
    lanes: mine.map((lane) => (slug ? lane.name : lane.key)),
    all: all.map((lane) => lane.key),
  };
}

/** `stop`: this stack's lanes (the daemon idles out once none is left), or everything. */
async function stop({ body }: { body: Request }) {
  const slug = body.stack?.slug;
  if (!slug || body.everything) {
    setImmediate(() => void shutdown({ why: "haven browser stop --all" }));
    return { stopped: true };
  }
  const closed = [...lanes.values()].filter((lane) => lane.stack.slug === slug);
  for (const lane of closed) await closeLane({ key: lane.key });
  return { stopped: false, closed: closed.map((lane) => lane.name) };
}

const OBSERVE_VERBS = new Set([
  "network",
  "network-show",
  "console",
  "profile-start",
  "profile-stop",
  "lean",
]);

const ROUTE_VERBS = new Set(["route-add", "route-off", "route-list"]);
const KNOWN_VERBS = new Set([
  ...Object.keys(actions),
  ...ROUTE_VERBS,
  ...OBSERVE_VERBS,
  "record-start",
  "record-stop",
  "record-save",
  "replay",
]);

async function handle({ verb, body }: { verb: string; body: Request }): Promise<unknown> {
  if (verb === "status") return status({ body });
  if (verb === "stop") return stop({ body });
  const stack = stackFor({ body: body.stack });
  const name = body.lane ?? "";
  if (!/^[\w-]+$/.test(name)) throw new Error("--lane must be letters, digits, - or _");
  if (!/^[\w.+@-]*$/.test(body.as ?? "")) throw new Error("--as must be admin or an email");
  const key = `${stack.slug}/${name}`;
  if (verb === "close") {
    idled.delete(key);
    await closeLane({ key });
    return { closed: name };
  }
  const mfaVerb = verb.startsWith("mfa-");
  const routeVerb = ROUTE_VERBS.has(verb);
  const observeVerb = OBSERVE_VERBS.has(verb);
  if (!mfaVerb && !KNOWN_VERBS.has(verb)) throw new Error(`unknown verb ${verb}`);
  if (idled.delete(key) && verb !== "open" && !lanes.has(key))
    throw new Error(`lane ${name} was closed after idling; reopen with open`);
  const timeout = body.timeoutMs ?? 30_000;
  const stateFile = verb === "state-load" ? body.file : undefined;
  const lane = await laneFor({ stack, name, as: body.as ?? "", timeout, stateFile });
  return onLane({
    lane,
    verb,
    body,
    timeout,
    run: () => dispatch({ lane, verb, body, timeout, mfaVerb, routeVerb, observeVerb }),
  });
}

/** Runs a verb with the lane marked busy, first reopening its page if idling unloaded it. */
async function onLane({
  lane,
  verb,
  body,
  timeout,
  run,
}: {
  lane: Lane;
  verb: string;
  body: Request;
  timeout: number;
  run: () => unknown;
}) {
  lane.busy += 1;
  touch({ lane });
  const reopened = lane.unloadedFrom !== undefined && !PAGELESS_VERBS.has(verb);
  try {
    if (reopened) await reopenPage({ lane, timeout });
    // A new page numbers its refs afresh, so an old ref could name another element.
    if (reopened && [body.ref, body.targetRef].some((ref) => /^(f\d+)?e\d+$/.test(ref ?? "")))
      throw new Error(
        `lane ${lane.name}'s page was reopened after idling, so earlier refs are gone; take a snapshot`,
      );
    if (body.lean) await setLean({ lane, on: true });
    return await run();
  } finally {
    lane.busy -= 1;
    if (lanes.get(lane.key) === lane) touch({ lane });
  }
}

/** Verbs that read the lane's buffers or its context, so an unloaded page stays closed. */
const PAGELESS_VERBS = new Set(["network", "network-show", "console", ...ROUTE_VERBS]);

/** Hands a lane's verb to its family: record, mfa, route, observe, else a page action. */
function dispatch({
  lane,
  verb,
  body,
  timeout,
  mfaVerb,
  routeVerb,
  observeVerb,
}: {
  lane: Lane;
  verb: string;
  body: Request;
  timeout: number;
  mfaVerb: boolean;
  routeVerb: boolean;
  observeVerb: boolean;
}) {
  if (verb.startsWith("record-") || verb === "replay")
    return recordCommand({ lane, verb, body, timeout });
  if (mfaVerb) return mfaCommand({ lane, verb, body, timeout });
  if (routeVerb) return routeCommand({ lane, verb, body });
  if (observeVerb) return observeCommand({ lane, verb, body });
  return withSlot({ run: () => perform({ lane, verb, body, timeout }) });
}

/** `network`, `console`, `lean` and `profile` on the lane: reads and switches, no page action. */
async function observeCommand({ lane, verb, body }: { lane: Lane; verb: string; body: Request }) {
  const appHost = lane.stack.app.host;
  if (verb === "network") {
    const after = body.sinceLast ? lane.netCursor : 0;
    const picked = pickNet({
      entries: lane.net,
      after,
      grep: body.grep,
      failed: body.failed,
      all: body.all,
    });
    lane.netCursor = lane.netSeq;
    return { entries: picked.map((entry) => netLine({ entry, appHost })) };
  }
  if (verb === "network-show") return networkShow({ lane, id: body.id ?? 0 });
  if (verb === "console") {
    const after = body.sinceLast ? lane.consoleCursor : 0;
    const picked = pickConsole({
      entries: lane.console,
      after,
      level: body.level,
      grep: body.grep,
    });
    lane.consoleCursor = lane.consoleSeq;
    return { entries: picked.map((entry) => consoleLine({ entry })) };
  }
  if (verb === "lean") {
    await setLean({ lane, on: body.mode !== "off" });
    return { lean: lane.lean };
  }
  return profileCommand({ lane, verb, body });
}

/** One request's bodies, secret-named fields hidden and clipped; binary bodies are named only. */
async function networkShow({ lane, id }: { lane: Lane; id: number }) {
  const entry = lane.net.find((candidate) => candidate.id === id);
  const request = lane.netRequests.get(id);
  if (!entry || !request)
    throw new Error(`lane ${lane.name} holds no request #${id} (it keeps the last ${NET_CAP})`);
  const response = await request.response().catch(() => null);
  const kind = response?.headers()["content-type"] ?? "";
  const textual = /json|text|javascript|xml|form/.test(kind);
  const raw =
    response && textual
      ? await response.text().catch((error: unknown) => `(body gone: ${String(error)})`)
      : "";
  const secrets = await shownSecrets({ page: lane.page, lane });
  const hide = (text: string) => redactSecrets({ text: redactBody({ text }), secrets });
  return {
    line: netLine({ entry, appHost: lane.stack.app.host }),
    url: entry.url,
    contentType: kind,
    requestBody: hide(request.postData() ?? ""),
    responseBody: response && !textual ? `(${kind || "binary"} body not shown)` : hide(raw),
  };
}

const LEAN_BLOCKED = new Set(["image", "font", "media"]);

/** Lean's route: images, fonts and media aborted, everything else on to the next handler. */
function leanRoute(route: Route) {
  const type = route.request().resourceType();
  return LEAN_BLOCKED.has(type) ? route.abort("blockedbyclient") : route.fallback();
}
const LEAN_STYLE = "*,*::before,*::after{animation:none!important;transition:none!important}";

/** Runs in the page: adds or removes lean's no-animation style. */
function styleLean({ on, css }: { on: boolean; css: string }) {
  const found = document.getElementById("haven-lean");
  if (!on) {
    found?.remove();
    return;
  }
  if (found) return;
  const style = document.createElement("style");
  style.id = "haven-lean";
  style.textContent = css;
  document.head.append(style);
}

/** Lean on: images, fonts and media aborted, animations off; off lifts both (for screenshots). */
async function setLean({ lane, on }: { lane: Lane; on: boolean }) {
  if (lane.lean === on) return;
  lane.lean = on;
  if (on) await lane.context.route("**/*", lane.leanRoute);
  else await lane.context.unroute("**/*", lane.leanRoute);
  await lane.page.evaluate(styleLean, { on, css: LEAN_STYLE }).catch(() => undefined);
}

/** The one page the shared browser traces; Chromium traces one at a time. */
let profiling: { key: string; mark: number } | undefined;

/** `profile start|stop`: a CDP performance trace, saved whole and summarised in a few lines. */
async function profileCommand({ lane, verb, body }: { lane: Lane; verb: string; body: Request }) {
  if (verb === "profile-start") {
    if (profiling)
      throw new Error(`lane ${profiling.key} is profiling; the browser traces one page at a time`);
    await browser.startTracing(lane.page, { screenshots: false });
    profiling = { key: lane.key, mark: lane.netSeq };
    return { profiling: lane.name };
  }
  if (verb !== "profile-stop") throw new Error(`unknown verb ${verb}`);
  if (profiling?.key !== lane.key)
    throw new Error(`lane ${lane.name} is not profiling (profile start first)`);
  const { mark } = profiling;
  profiling = undefined;
  const trace = await browser.stopTracing();
  const file = body.out ?? join(lane.stack.dir, `${lane.name}.trace.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, trace);
  const parsed: { traceEvents?: TraceEvent[] } | TraceEvent[] = JSON.parse(trace.toString("utf8"));
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const requests = lane.net.filter((entry) => entry.id > mark);
  return { file, summary: summariseTrace({ events, requests, appHost: lane.stack.app.host }) };
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

async function shutdown({ why }: { why: string }) {
  console.error(`daemon stopping: ${why}; ${memoryNote()}`);
  closing = true;
  server.close();
  await browser.close().catch(() => undefined);
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
  process.on(signal, () => void shutdown({ why: `killed by ${signal}` }));

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(`${JSON.stringify({ port, protocol: PROTOCOL })}\n`);
  scheduleExit();
});
