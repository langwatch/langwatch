/**
 * `haven browser`'s daemon (tools/thuishaven/cmd/browser.go starts it): one
 * headless shell per stack, one context per lane, commands over loopback HTTP.
 * Waits are page and log events, never sleeps; stdout carries one line only.
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

import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";

import {
  REDACTED,
  dedupe,
  describeElement,
  locatorOf,
  missingQuery,
  queriesOf,
  recordLocator,
  type LocatorSpec,
  type Query,
  type Script,
  type Step,
} from "./browser-record.ts";
import { filterSnapshot } from "./browser-snapshot.ts";
import { parseTotp, redactSecrets, totpCode, wrongCode, type Totp } from "./mfa-totp.ts";

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
const LANE_IDLE_MS = Number(process.env.HAVEN_BROWSER_LANE_IDLE_MS ?? 10 * 60_000);
const MAX_LANES = Number(process.env.HAVEN_BROWSER_MAX_LANES ?? 16);
const MAX_RSS_MB = Number(process.env.HAVEN_BROWSER_MAX_RSS_MB ?? 8192);
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
  /** App queries seen since the last action began; `recording` keeps the steps so far. */
  seen: Query[];
  inflight: number;
  recording?: Script;
  /** The CDP session with the lane's virtual authenticators (haven mfa); closing drops them. */
  webauthn?: CDPSession;
  authenticators: Map<string, { kind: string; userVerified: boolean }>;
};
const lanes = new Map<string, Lane>();
/** Lanes closed for idling, told once on their next command. */
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
  return kb / 1024;
}

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
  const args = ["browser", "login", "--as", as, "--out", file, "--stack", STACK, "--agent"];
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
  const done = () => void (lane.inflight = Math.max(0, lane.inflight - 1));
  page.on("request", () => void (lane.inflight += 1));
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  page.on("response", (response) => {
    const status = response.status();
    const type = response.request().resourceType();
    if (type === "fetch" || type === "xhr")
      lane.seen.push(
        ...queriesOf({
          method: response.request().method(),
          url: response.url(),
          status,
          appHost: APP.host,
        }),
      );
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
  const rss = await treeRssMb();
  if (rss > MAX_RSS_MB) {
    throw new Error(
      `the browser uses ${Math.round(rss)} MB (ceiling ${MAX_RSS_MB} MB): refusing a new lane; close one (haven browser close --lane <name>)`,
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
  const lane: Lane = {
    name,
    as,
    context,
    page,
    signedOut: false,
    seen: [],
    inflight: 0,
    authenticators: new Map(),
  };
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
  lane.idle = setTimeout(() => {
    idled.add(lane.name);
    console.error(`lane ${lane.name} closed after idling ${LANE_IDLE_MS} ms`);
    void closeLane({ name: lane.name });
  }, LANE_IDLE_MS);
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
  /** `haven mfa totp fill --wrong`: type a code no window accepts. */
  wrong?: boolean;
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

type Act = (args: { page: Page; body: Request; timeout: number }) => Promise<unknown>;

/** playwright-cli's verbs; a ref is one an ai-mode snapshot printed (`[ref=e12]`). */
const actions: Record<string, Act> = {
  open: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  goto: async ({ page }) => ({ url: page.url(), title: await page.title() }),
  "state-load": async ({ page }) => ({ url: page.url(), title: await page.title() }),
  snapshot: async ({ page, body, timeout }) => ({
    url: page.url(),
    title: await page.title(),
    snapshot: filterSnapshot({
      text: redactSecrets({
        text: await page.ariaSnapshot({ mode: "ai", timeout }),
        secrets: await shownSecrets({ page, lane: body.lane ?? "" }),
      }),
      grep: body.grep,
      depth: body.depth,
      maxChars: body.maxChars,
    }),
  }),
  screenshot: async ({ page, body, timeout }) => {
    const file = body.out ?? join(DIR, `${body.lane}.png`);
    mkdirSync(dirname(file), { recursive: true });
    const mask = (await shownSecrets({ page, lane: "" })).length
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
  eval: async ({ page, body }) => {
    const value: unknown = await page.evaluate(body.expression ?? "undefined");
    const secrets = await shownSecrets({ page, lane: body.lane ?? "" });
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
async function shownSecrets({ page, lane }: { page: Page; lane: string }) {
  const raw = await page.evaluate(totpOnPage).catch(() => [] as string[]);
  const secrets = raw.flatMap((text) => parseTotp({ raw: text })?.secret ?? []);
  const stored = lane ? readTotp({ lane }) : undefined;
  return stored ? [...secrets, stored.secret] : secrets;
}

/** Where a lane's TOTP secret lives: the daemon's own state, mode 600, never echoed. */
const totpFile = ({ lane }: { lane: string }) => join(DIR, "mfa", `${lane}.totp.json`);

function readTotp({ lane }: { lane: string }): Totp | undefined {
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

/** The step a recorded verb stands for, described before the action changes the page. */
async function describeStep({
  page,
  verb,
  body,
  url,
}: {
  page: Page;
  verb: string;
  body: Request;
  url: string;
}): Promise<Omit<Step, "expect"> | undefined> {
  if ((verb === "goto" || verb === "open") && url) {
    const target = new URL(url, APP);
    return { verb: "goto", url: target.pathname + target.search };
  }
  if (verb === "press") return { verb: "press", key: body.key };
  if (verb === "type") {
    const focus = await page
      .locator(":focus")
      .evaluate(describeElement)
      .catch(() => undefined);
    return { verb: "type", text: focus?.secret ? REDACTED : body.text };
  }
  if (verb === "drag") return describeDrag({ page, body });
  if (verb === "click" || verb === "hover" || verb === "fill" || verb === "select")
    return describeTarget({ page, verb, body });
  return undefined;
}

async function describeDrag({
  page,
  body,
}: {
  page: Page;
  body: Request;
}): Promise<Omit<Step, "expect">> {
  const { spec } = await recordLocator({ page, target: targetOf({ page, body }) });
  const drop = dropTargetOf({ page, body });
  const target = drop && (await recordLocator({ page, target: drop })).spec;
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
}: {
  page: Page;
  verb: "click" | "hover" | "fill" | "select";
  body: Request;
}): Promise<Omit<Step, "expect">> {
  const { spec, described } = await recordLocator({ page, target: targetOf({ page, body }) });
  return {
    verb,
    locator: spec,
    ...(verb !== "click" && verb !== "hover" && { text: described.secret ? REDACTED : body.text }),
    ...(verb === "select" && { native: described.tag === "select" }),
  };
}

/** Runs one verb on the lane's page, appending a step when the lane is recording. */
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
  lane.seen = [];
  const blank = lane.page.url() === "about:blank";
  const url = body.url || (blank ? "/" : "");
  await visit({ lane, url, waitFor: body.waitFor ?? "", timeout });
  const step = lane.recording
    ? await describeStep({ page: lane.page, verb, body, url })
    : undefined;
  const result = await act({ page: lane.page, body, timeout });
  if (observe || lane.recording) await quiet({ lane, timeout });
  if (step && lane.recording)
    lane.recording.steps.push({
      ...step,
      expect: { url: pathOf(lane.page.url()), queries: dedupe(lane.seen) },
    });
  return result;
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
    await perform({ lane, verb: "goto", body: { url: script.startUrl }, timeout });
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
  if (verb === "replay") {
    if (!body.script) throw new Error("replay needs a script");
    const script = body.script;
    return withSlot({ run: () => replay({ lane, script, timeout }) });
  }
  throw new Error(`unknown verb ${verb}`);
}

/** `haven mfa`: virtual WebAuthn authenticators and TOTP codes on the lane's page. */
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
    throw new Error(`lane ${lane.name} has no authenticator ${authenticatorId} (haven mfa list)`);
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
  const file = totpFile({ lane: lane.name });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(totp), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { enrolled: lane.name, digits: totp.digits, period: totp.period };
}

/** Types the current code (or, with --wrong, one no window accepts) without returning it. */
async function totpFill({ lane, body, timeout }: { lane: Lane; body: Request; timeout: number }) {
  const totp = readTotp({ lane: lane.name });
  if (!totp) throw new Error(`lane ${lane.name} has no TOTP secret (haven mfa totp enroll)`);
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
    idled.delete(name);
    await closeLane({ name });
    return { closed: name };
  }
  const mfaVerb = verb.startsWith("mfa-");
  if (!actions[verb] && !mfaVerb && !["record-start", "record-stop", "replay"].includes(verb))
    throw new Error(`unknown verb ${verb}`);
  if (idled.delete(name) && verb !== "open" && !lanes.has(name))
    throw new Error(`lane ${name} was closed after idling; reopen with open`);
  const timeout = body.timeoutMs ?? 30_000;
  const stateFile = verb === "state-load" ? body.file : undefined;
  const lane = await laneFor({ name, as: body.as ?? "", timeout, stateFile });
  touch({ lane });
  if (verb === "record-start" || verb === "record-stop" || verb === "replay")
    return recordCommand({ lane, verb, body, timeout });
  if (mfaVerb) return mfaCommand({ lane, verb, body, timeout });
  return withSlot({ run: () => perform({ lane, verb, body, timeout }) });
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
