import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Browser, BrowserContext, Page, Request, Response } from "playwright";
import { chromium } from "playwright";

import { isModuleConsoleError, isModuleRequest } from "./module-load";
import { isExpectedThrottle, isThrottleConsoleError } from "./noise";
import {
  note,
  type CaptureMessage,
  type PlanSide,
  type SettleConfig,
  type Viewport,
} from "./protocol";
import { StepRecorder, type Drained } from "./recorder";
import { InFlightTracker, shouldIgnoreRequest } from "./settle";
import { serveBuiltUi } from "./static-ui";

/** Animations and carets are the largest source of pixel noise between two identical screens. */
const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

// The splash screen and its fade-out ghost (design-system loading-screen.tsx) count as loading.
const LOADING_SELECTOR =
  '.chakra-skeleton,[data-skeleton],[aria-busy="true"],[data-loading="true"],.chakra-spinner,[data-testid="loading-screen"],[data-loading-screen-ghost]';

const MAX_SCREENSHOT_HEIGHT = 6000;

const MAX_ARIA_SNAPSHOT = 64_000;

/** Relative times move between two renders of the same screen; they are masked in the pixels. */
const RELATIVE_TIME =
  /\b(?:\d+|an?|a few) (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago\b|\bjust now\b/i;

export const contextOptions = ({
  viewport,
  storageState,
}: {
  viewport: Viewport;
  storageState?: string;
}) => ({
  viewport: { width: viewport.width, height: viewport.height },
  reducedMotion: "reduce" as const,
  colorScheme: "light" as const,
  deviceScaleFactor: 1,
  ...(storageState === undefined ? {} : { storageState }),
});

/** LOADING_WAIT_MILLIS bounds the wait for skeletons after the network settles. */
const LOADING_WAIT_MILLIS = 5000;

/** LOADING_POLL_MILLIS paces that wait: six pages polling every frame starve the renderer. */
const LOADING_POLL_MILLIS = 100;

/** SCREENSHOT_TIMEOUT_MILLIS covers a tall page, which the context's default timeout does not. */
const SCREENSHOT_TIMEOUT_MILLIS = 20_000;

/** EVALUATE_TIMEOUT_MILLIS bounds a page call with no timeout, so a wedged page never hangs. */
const EVALUATE_TIMEOUT_MILLIS = 5_000;

/** bounded settles to fallback when work takes longer than millis, or fails. */
export const bounded = async <Value>({
  work,
  millis,
  fallback,
}: {
  work: Promise<Value>;
  millis: number;
  fallback: Value;
}): Promise<Value> => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Value>((done) => {
    timer = setTimeout(() => done(fallback), millis);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
};

/** requestTiming renders where a late request spent its time, from the browser's own timing. */
export const requestTiming = ({
  request,
  total,
}: {
  request: Pick<Request, "timing">;
  total: number;
}): string => {
  const timing = request.timing();
  const phase = (from: number, to: number): string =>
    from >= 0 && to >= from ? `${Math.round(to - from)}ms` : "?";
  return `total=${total}ms queued=${phase(0, timing.requestStart)} server=${phase(timing.requestStart, timing.responseStart)} body=${phase(timing.responseStart, timing.responseEnd)}`;
};

/** SettleOutcome is how one settle ended, for the caller's deadline alarm. */
export interface SettleOutcome {
  expired: boolean;
  inFlight: string[];
  stillLoading: boolean;
}

/** isDocumentLoad is a navigation of the main frame: the previous document's requests are over. */
const isDocumentLoad = ({ request, page }: { request: Request; page: Page }): boolean => {
  if (!request.isNavigationRequest()) return false;
  return request.frame() === page.mainFrame();
};

/** Side is one running stack, with its page and everything that page reported. */
export class Side {
  private readonly recorder = new StepRecorder();
  private readonly tracker: InFlightTracker<Request>;
  /** late are the requests a settle ran out on, and when each started, logged once they end. */
  private readonly late = new Map<Request, number>();

  constructor(
    readonly name: string,
    readonly baseUrl: string,
    readonly page: Page,
    settle: SettleConfig,
  ) {
    this.tracker = new InFlightTracker<Request>(settle, Date.now());
    page.on("request", (request: Request) => {
      const now = Date.now();
      if (isDocumentLoad({ request, page })) this.tracker.navigated(now);
      this.tracker.started({
        key: request,
        url: request.url(),
        resourceType: request.resourceType(),
        now,
      });
    });
    page.on("requestfinished", (request: Request) => {
      this.tracker.settled({ key: request, now: Date.now() });
      this.lateEnded(request);
    });
    page.on("requestfailed", (request: Request) => this.requestFailed(request));
    page.on("response", (response: Response) => this.responded(response));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      const { url } = message.location();
      if (isThrottleConsoleError({ text, url })) return;
      if (isModuleConsoleError(text)) this.recorder.moduleFailure(text);
      this.recorder.consoleError(text);
    });
    page.on("pageerror", (error) => {
      this.recorder.consoleError(`pageerror: ${String(error.message)}`);
    });
  }

  /** goto opens a path on this side; the tracker forgets the document it leaves. */
  async goto(path: string): Promise<void> {
    this.tracker.navigated(Date.now());
    await this.page.goto(this.baseUrl + path, { waitUntil: "commit", timeout: 20_000 });
  }

  /** lateEnded logs where a request the deadline gave up on spent its time. */
  private lateEnded(request: Request): void {
    const startedAt = this.late.get(request);
    if (startedAt === undefined) return;
    this.late.delete(request);
    note({
      text: `${this.name} late ${request.method()} ${this.relative(request.url())} ${requestTiming({ request, total: Date.now() - startedAt })}`,
      err: process.stderr,
    });
  }

  private requestFailed(request: Request): void {
    this.tracker.settled({ key: request, now: Date.now() });
    this.lateEnded(request);
    const url = request.url();
    const errorText = request.failure()?.errorText ?? "";
    const failure = `FAIL ${request.method()} ${this.relative(url)} ${errorText}`;
    this.recordModuleFailure({ request, failure });
    if (shouldIgnoreRequest({ url, resourceType: request.resourceType() })) return;
    this.recorder.failedRequest(failure);
  }

  private responded(response: Response): void {
    const request = response.request();
    const status = response.status();
    if (status < 400) return;
    const url = request.url();
    const failure = `${status} ${request.method()} ${this.relative(url)}`;
    this.recordModuleFailure({ request, failure });
    if (shouldIgnoreRequest({ url, resourceType: request.resourceType() })) return;
    if (isExpectedThrottle({ url, status })) return;
    this.recorder.failedRequest(failure);
  }

  /** recordModuleFailure keeps a failed load of one of the page's own modules apart. */
  private recordModuleFailure({ request, failure }: { request: Request; failure: string }): void {
    const url = request.url();
    const resourceType = request.resourceType();
    const origin = new URL(this.baseUrl).origin;
    if (!isModuleRequest({ url, resourceType, origin })) return;
    if (/net::ERR_ABORTED/.test(failure)) return;
    this.recorder.moduleFailure(failure);
  }

  relative(url: string): string {
    return url.replace(this.baseUrl, "").slice(0, 160);
  }

  async waitUntilQuiet(): Promise<SettleOutcome> {
    this.tracker.begin(Date.now());
    let expired = false;
    for (;;) {
      const decision = this.tracker.decide(Date.now());
      expired = decision.expired;
      if (decision.quiet || decision.expired) break;
      await this.page.waitForTimeout(50);
    }
    const now = Date.now();
    const waiting = expired ? this.tracker.waitingOn(now) : [];
    const inFlight = waiting.map((request) => request.url);
    for (const request of waiting) this.late.set(request.key, request.startedAt);
    if (expired) {
      const listed = waiting.map(
        (request) => `${this.relative(request.url)} (${now - request.startedAt}ms)`,
      );
      note({
        text: `${this.name} settle deadline at ${this.relative(this.page.url())}; still in flight: ${listed.join(", ") || "none"}`,
        err: process.stderr,
      });
    }
    const stillLoading = await this.page
      .waitForFunction(
        // An unmounted shell has no skeleton either; textContent forces no layout.
        (selector: string) =>
          document.querySelectorAll(selector).length === 0 &&
          (document.body?.textContent ?? "").trim() !== "",
        LOADING_SELECTOR,
        { timeout: LOADING_WAIT_MILLIS, polling: LOADING_POLL_MILLIS },
      )
      .then(
        () => false,
        () => true,
      );
    if (stillLoading) {
      note({
        text: `${this.name} still loading at ${this.relative(this.page.url())}`,
        err: process.stderr,
      });
    }
    const millis = EVALUATE_TIMEOUT_MILLIS;
    await bounded({
      work: this.page.addStyleTag({ content: FREEZE_CSS }),
      millis,
      fallback: undefined,
    });
    await bounded({
      work: this.page.evaluate(async () => {
        await document.fonts?.ready;
      }),
      millis,
      fallback: undefined,
    });
    return { expired, inFlight, stillLoading };
  }

  /** drain hands back everything reported since the last drain, and forgets it. */
  drain(): Drained {
    return this.recorder.drain();
  }

  /** notFound reports whether the screen is the application's own not-found page. */
  async notFound(): Promise<boolean> {
    const text = await this.page.innerText("body").catch(() => "");
    return /page not found|404/i.test(text.slice(0, 400));
  }

  /** ariaSnapshot is the page's accessibility tree, or "" when it cannot be read. */
  async ariaSnapshot(): Promise<string> {
    const snapshot = await this.page
      .locator("body")
      .ariaSnapshot({ timeout: 5_000 })
      .catch(() => "");
    return snapshot.slice(0, MAX_ARIA_SNAPSHOT);
  }

  /** blank reports a page with no text at all, the shape of a shell that never mounted. */
  async blank(): Promise<boolean> {
    const text = await this.page.innerText("body").catch(() => "");
    return text.trim() === "";
  }

  async screenshot(file: string): Promise<void> {
    mkdirSync(dirname(file), { recursive: true });
    const height = await bounded({
      work: this.page.evaluate(() => document.documentElement.scrollHeight),
      millis: EVALUATE_TIMEOUT_MILLIS,
      fallback: 0,
    });
    const viewport = this.page.viewportSize();
    const mask = [this.page.locator("time"), this.page.getByText(RELATIVE_TIME)];
    if (height > MAX_SCREENSHOT_HEIGHT && viewport) {
      await this.page.screenshot({
        path: file,
        animations: "disabled",
        mask,
        timeout: SCREENSHOT_TIMEOUT_MILLIS,
        clip: { x: 0, y: 0, width: viewport.width, height: MAX_SCREENSHOT_HEIGHT },
      });
      return;
    }
    await this.page.screenshot({
      path: file,
      fullPage: true,
      animations: "disabled",
      mask,
      timeout: SCREENSHOT_TIMEOUT_MILLIS,
    });
  }
}

/**
 * FULFILLED_SHELL: a document the runner fulfils has no address space, so Chromium reads it as
 * public and refuses its own stack's websocket as a local-network request.
 */
const FULFILLED_SHELL = "--disable-features=LocalNetworkAccessChecks";

/** builtAssets serves a side's prebuilt UI, or says why the side stays on its dev server. */
const builtAssets = async ({
  context,
  side,
}: {
  context: BrowserContext;
  side: PlanSide;
}): Promise<void> => {
  const dir = side.staticDir ?? "";
  try {
    await serveBuiltUi({ context, baseUrl: side.baseUrl, dir });
    note({ text: `${side.name}: serving the prebuilt UI from ${dir}`, err: process.stderr });
  } catch (thrown) {
    note({
      text: `${side.name}: the prebuilt UI could not be served, capturing from the dev server: ${String(thrown)}`,
      err: process.stderr,
    });
  }
};

/**
 * SideBrowser is one stack's browser and its one signed-in context. Every page
 * it opens is its own Side, with its own tracker and recorder, so pages capture
 * at once without reading each other's requests.
 */
export class SideBrowser {
  constructor(
    readonly definition: PlanSide,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly settle: SettleConfig,
  ) {}

  get name(): string {
    return this.definition.name;
  }

  async openPage(): Promise<Side> {
    const page = await this.context.newPage();
    return new Side(this.definition.name, this.definition.baseUrl, page, this.settle);
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }
}

export const openSideBrowser = async ({
  side,
  viewport,
  settle,
  storageState,
  frozenTime,
}: {
  side: PlanSide;
  viewport: Viewport;
  settle: SettleConfig;
  storageState?: string;
  frozenTime?: number;
}): Promise<SideBrowser> => {
  const args = ["--disable-dev-shm-usage"];
  if (side.staticDir !== undefined) args.push(FULFILLED_SHELL);
  const browser = await chromium.launch({ args });
  const context = await browser.newContext(contextOptions({ viewport, storageState }));
  if (frozenTime !== undefined) await context.clock.setFixedTime(frozenTime);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("chakra-ui-color-mode", "light");
    } catch {
      // A context that refuses storage still renders; the colour mode just falls back.
    }
  });
  context.setDefaultTimeout(10_000);
  if (side.staticDir !== undefined) await builtAssets({ context, side });
  return new SideBrowser(side, browser, context, settle);
};

/** captureMessage assembles one protocol capture from a side's current state. */
export const captureMessage = ({
  kind,
  key,
  index,
  label,
  side,
  screenshot,
  error,
  durationMs,
  notFound,
  blank,
  ariaSnapshot,
  expect,
}: {
  kind: "route" | "flow";
  key: string;
  index: number;
  label: string;
  side: Side;
  screenshot: string;
  error: string;
  durationMs: number;
  notFound: boolean;
  blank: boolean;
  ariaSnapshot: string;
  expect?: string;
}): CaptureMessage => {
  const drained = side.drain();
  return {
    type: "capture",
    kind,
    key,
    index,
    label,
    side: side.name,
    url: side.page.url(),
    screenshot,
    consoleErrors: drained.consoleErrors,
    failedRequests: drained.failedRequests,
    moduleFailures: drained.moduleFailures,
    notFound,
    blank,
    ariaSnapshot,
    error,
    durationMs,
    ...(expect === undefined ? {} : { expect }),
  };
};
