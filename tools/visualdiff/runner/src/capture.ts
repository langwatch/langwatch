import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Page, Request, Response } from "playwright";
import { chromium } from "playwright";
import { StepRecorder } from "./recorder";
import { InFlightTracker, shouldIgnoreRequest } from "./settle";
import type { CaptureMessage, PlanSide, SettleConfig, Viewport } from "./protocol";

/** Animations and carets are the largest source of pixel noise between two identical screens. */
const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

const LOADING_SELECTOR =
  '.chakra-skeleton,[data-skeleton],[aria-busy="true"],[data-loading="true"],.chakra-spinner';

const MAX_SCREENSHOT_HEIGHT = 6000;

/** contextOptions is the browser context both sides open with — same viewport, same colour scheme, same motion. */
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

/** Side is one running stack, with its page and everything that page reported. */
export class Side {
  private readonly recorder = new StepRecorder();
  private tracker: InFlightTracker;

  constructor(
    readonly name: string,
    readonly baseUrl: string,
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly settle: SettleConfig,
  ) {
    this.tracker = new InFlightTracker(settle, Date.now());
    page.on("request", (request: Request) => {
      this.tracker.started({ url: request.url(), resourceType: request.resourceType() });
    });
    page.on("requestfinished", (request: Request) => {
      this.tracker.settled({
        url: request.url(),
        resourceType: request.resourceType(),
        now: Date.now(),
      });
    });
    page.on("requestfailed", (request: Request) => {
      this.tracker.settled({
        url: request.url(),
        resourceType: request.resourceType(),
        now: Date.now(),
      });
      if (shouldIgnoreRequest({ url: request.url(), resourceType: request.resourceType() })) return;
      this.recorder.failedRequest(
        `FAIL ${request.method()} ${this.relative(request.url())} ${request.failure()?.errorText ?? ""}`,
      );
    });
    page.on("response", (response: Response) => {
      const request = response.request();
      if (response.status() < 400) return;
      if (shouldIgnoreRequest({ url: request.url(), resourceType: request.resourceType() })) return;
      this.recorder.failedRequest(
        `${response.status()} ${request.method()} ${this.relative(request.url())}`,
      );
    });
    page.on("console", (message) => {
      if (message.type() === "error") this.recorder.consoleError(message.text());
    });
    page.on("pageerror", (error) => {
      this.recorder.consoleError(`pageerror: ${String(error.message)}`);
    });
  }

  relative(url: string): string {
    return url.replace(this.baseUrl, "").slice(0, 160);
  }

  /** waitUntilQuiet returns once nothing is in flight and no loader is on screen, or at the deadline. */
  async waitUntilQuiet(): Promise<void> {
    this.tracker = this.tracker.restart(Date.now());
    for (;;) {
      const decision = this.tracker.decide(Date.now());
      if (decision.quiet || decision.expired) break;
      await this.page.waitForTimeout(50);
    }
    await this.page
      .waitForFunction(
        (selector: string) => document.querySelectorAll(selector).length === 0,
        LOADING_SELECTOR,
        { timeout: Math.min(this.settle.deadlineMillis, 15_000) },
      )
      .catch(() => undefined);
    await this.page.addStyleTag({ content: FREEZE_CSS }).catch(() => undefined);
    await this.page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  }

  /** drain hands back everything reported since the last drain, and forgets it. */
  drain(): { consoleErrors: string[]; failedRequests: string[] } {
    return this.recorder.drain();
  }

  /** notFound reports whether the screen is the application's own not-found page. */
  async notFound(): Promise<boolean> {
    const text = await this.page.innerText("body").catch(() => "");
    return /page not found|404/i.test(text.slice(0, 400));
  }

  async screenshot(file: string): Promise<void> {
    mkdirSync(dirname(file), { recursive: true });
    const height = await this.page
      .evaluate(() => document.documentElement.scrollHeight)
      .catch(() => 0);
    const viewport = this.page.viewportSize();
    if (height > MAX_SCREENSHOT_HEIGHT && viewport) {
      await this.page.screenshot({
        path: file,
        animations: "disabled",
        clip: { x: 0, y: 0, width: viewport.width, height: MAX_SCREENSHOT_HEIGHT },
      });
      return;
    }
    await this.page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  }
}

export const openSide = async ({
  side,
  viewport,
  settle,
  storageState,
}: {
  side: PlanSide;
  viewport: Viewport;
  settle: SettleConfig;
  storageState?: string;
}): Promise<Side> => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext(contextOptions({ viewport, storageState }));
  await context.addInitScript(() => {
    try {
      localStorage.setItem("chakra-ui-color-mode", "light");
    } catch {
      // A context that refuses storage still renders; the colour mode just falls back.
    }
  });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  return new Side(side.name, side.baseUrl, browser, context, page, settle);
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
    notFound,
    error,
    durationMs,
  };
};
