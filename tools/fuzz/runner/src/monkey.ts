import { bounded, type Side } from "@langwatch/visual-diff-runner/capture";
import { note } from "@langwatch/visual-diff-runner/protocol";
import type { Page, Request, Response } from "playwright";

import { GATHER_SOURCE, parseGathered, type Gathered } from "./gather.ts";
import {
  classifyHang,
  classifyScreen,
  classifyStep,
  normalisePath,
  type Draft,
  type RawEvent,
} from "./oracles.ts";
import { pickAction, trailStep, type Action, type TrailStep } from "./picker.ts";
import type { FuzzPlan, Navigation, Oracle } from "./protocol.ts";
import { oracleOf, routeLabel, signatureOf, trailLine } from "./report.ts";
import { hashSeed, mulberry32, type Rng } from "./rng.ts";
import type { FindingSink } from "./sink.ts";

/** Collector buffers what one page reports between two looks, so a finding names its action. */
export class Collector {
  private events: RawEvent[] = [];

  constructor(page: Page) {
    page.on("pageerror", (error) =>
      this.events.push({ type: "pageerror", message: String(error.message) }),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        this.events.push({ type: "console", text: message.text(), url: message.location().url });
      }
    });
    page.on("response", (response: Response) =>
      this.events.push({
        type: "response",
        status: response.status(),
        method: response.request().method(),
        url: response.url(),
        resourceType: response.request().resourceType(),
      }),
    );
    page.on("requestfailed", (request: Request) =>
      this.events.push({
        type: "requestfailed",
        method: request.method(),
        url: request.url(),
        error: request.failure()?.errorText ?? "",
        resourceType: request.resourceType(),
      }),
    );
    // A native confirm is never accepted: accepting is how a monkey deletes things.
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  }

  take(): RawEvent[] {
    const taken = this.events;
    this.events = [];
    return taken;
  }
}

/** STUCK_OVERLAY_ACTIONS is how long the monkey tries to close an overlay before it reloads. */
const STUCK_OVERLAY_ACTIONS = 4;
/** BROKEN_ORACLES are findings that leave the page unusable: the next visit loads afresh. */
const BROKEN_ORACLES: ReadonlySet<Oracle> = new Set([
  "page-error",
  "error-boundary",
  "blank",
  "hang",
]);
const BLANK_RECHECK_MILLIS = 2000;
const ACTION_TIMEOUT_MILLIS = 3000;
const READ_TIMEOUT_MILLIS = 5000;

const perform = async ({ page, action }: { page: Page; action: Action }): Promise<void> => {
  if (action.kind === "escape") return page.keyboard.press("Escape");
  const target = page.locator(`[data-fuzz-id="${action.candidate.id}"]`).first();
  if (action.kind === "fill") {
    await target.fill(action.value.value, { timeout: ACTION_TIMEOUT_MILLIS });
    if (action.submit) await target.press("Enter", { timeout: ACTION_TIMEOUT_MILLIS });
    return;
  }
  await target.click({ timeout: ACTION_TIMEOUT_MILLIS });
};

/** StepContext is what the page said during the step a finding came from. */
interface StepContext {
  console: string[];
  requests: string[];
}
const EMPTY_CONTEXT: StepContext = { console: [], requests: [] };
const CONTEXT_LINES = 10;

const contextOf = (events: readonly RawEvent[]): StepContext => ({
  console: events
    .flatMap((event) => (event.type === "console" ? [event.text.slice(0, 300)] : []))
    .slice(0, CONTEXT_LINES),
  requests: events
    .flatMap((event) =>
      event.type === "response" && event.status >= 400
        ? [`${event.method} ${event.url} ${event.status}`]
        : [],
    )
    .slice(0, CONTEXT_LINES),
});

export interface Visit {
  side: Side;
  collector: Collector;
  plan: FuzzPlan;
  sink: FindingSink;
  route: string;
  path: string;
  visit: number;
  /** navigation is how the lane wants to reach the route; a failed in-app move loads instead. */
  navigation: Navigation;
  avoid: readonly RegExp[];
  now: () => number;
  deadline: number;
}

export interface VisitResult {
  actions: number;
  findings: number;
  paths: string[];
  moduleFailures: number;
  /** navigation is how the route was actually reached; broken says the page was left unusable. */
  navigation: Navigation;
  fellBack: boolean;
  broken: boolean;
  /** error is why the harness or stack failed this visit (a stall, a closed page); "" if none. */
  error: string;
}

export class SessionLost extends Error {}

/** RouteWalk is one visit to one route: its trail so far, and what it has already reported. */
class RouteWalk {
  private readonly trail: TrailStep[] = [];
  private readonly seen = new Set<string>();
  private readonly paths = new Set<string>();
  private readonly origin: string;
  private readonly rng: Rng;
  private findings = 0;
  private actions = 0;
  private stuck = 0;
  private moduleFailures = 0;
  private navigation: Navigation;
  private fellBack = false;
  private broken = false;
  private error = "";

  constructor(private readonly visit: Visit) {
    this.navigation = visit.navigation;
    this.origin = new URL(visit.plan.url).origin;
    this.rng = mulberry32(hashSeed([visit.plan.seed, visit.route, visit.visit]));
  }

  private get page(): Page {
    return this.visit.side.page;
  }

  /** run opens the route, then acts until the plan's actions or the deadline are spent. */
  async run(): Promise<VisitResult> {
    const { plan, path } = this.visit;
    this.visit.collector.take();
    this.trail.push({ n: 0, action: "open", target: path, url: this.origin + path });
    await this.open();
    for (let n = 1; n <= plan.actionsPerRoute && this.visit.now() < this.visit.deadline; n++) {
      if (!(await this.step(n))) break;
    }
    return {
      actions: this.actions,
      findings: this.findings,
      paths: [...this.paths],
      moduleFailures: this.moduleFailures,
      navigation: this.navigation,
      fellBack: this.fellBack,
      broken: this.broken,
      error: this.error,
    };
  }

  /** moveInApp asks the router to go to the path, with no document load, and checks it did. */
  private async moveInApp(): Promise<boolean> {
    const { path } = this.visit;
    const moved = await this.page
      .evaluate((target) => {
        window.history.pushState(null, "", target);
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      }, path)
      .then(() => true)
      .catch(() => false);
    if (!moved) return false;
    await this.settle();
    return new URL(this.page.url(), this.origin).pathname === new URL(path, this.origin).pathname;
  }

  private async open(): Promise<void> {
    if (this.navigation === "in-app") {
      if (await this.moveInApp()) return this.inspect();
      this.navigation = "reload";
      this.fellBack = true;
    }
    await this.visit.side.goto(this.visit.path).catch((thrown: unknown) => {
      note({
        text: `goto ${this.visit.path}: ${String(thrown).slice(0, 200)}`,
        err: process.stderr,
      });
    });
    await this.settle();
    await this.inspect();
  }

  /** step does one action; false ends the visit because the page stopped answering. */
  private async step(n: number): Promise<boolean> {
    const gathered = await this.gather();
    if (gathered === undefined) {
      this.error ||= "page unresponsive";
      await this.record([classifyHang({ what: "page unresponsive", url: this.page.url() })]);
      return false;
    }
    this.stuck = gathered.overlayOpen ? this.stuck + 1 : 0;
    if (this.stuck > STUCK_OVERLAY_ACTIONS) {
      this.trail.push({ n, action: "reload", target: this.visit.path, url: this.page.url() });
      this.stuck = 0;
      await this.visit.side.goto(this.visit.path).catch(() => undefined);
      await this.settle();
      return true;
    }
    const action = pickAction({
      rng: this.rng,
      candidates: gathered.candidates,
      overlayOpen: gathered.overlayOpen,
      extraAvoid: this.visit.avoid,
    });
    this.trail.push(trailStep({ n, action, url: this.page.url() }));
    this.actions += 1;
    const finished = await bounded({
      work: perform({ page: this.page, action }).then(() => true),
      millis: this.visit.plan.actionCapMillis,
      fallback: false,
    });
    if (!finished && this.page.isClosed()) {
      this.error ||= "page closed";
      return false;
    }
    await this.settle();
    await this.inspect();
    return this.returnHome();
  }

  private async gather(): Promise<Gathered | undefined> {
    return bounded<Gathered | undefined>({
      work: this.page.evaluate(GATHER_SOURCE).then(parseGathered),
      millis: READ_TIMEOUT_MILLIS,
      fallback: undefined,
    });
  }

  /** returnHome brings the page back when an action left the application. */
  private async returnHome(): Promise<boolean> {
    if (new URL(this.page.url(), this.origin).origin === this.origin) return true;
    await this.visit.side.goto(this.visit.path).catch(() => undefined);
    await this.settle();
    return true;
  }

  private async settle(): Promise<void> {
    const outcome = await this.visit.side.waitUntilQuiet();
    const url = this.page.url();
    if (outcome.expired && outcome.inFlight.length > 0) {
      const what = `request pending ${outcome.inFlight[0]?.slice(0, 120)}`;
      await this.record([classifyHang({ what, url })]);
    } else if (outcome.stillLoading) {
      this.error ||= "still loading";
      await this.record([classifyHang({ what: "still loading", url })]);
    }
  }

  /** inspect reads what the page reported and what it now shows, and records the findings. */
  private async inspect(): Promise<void> {
    const { origin } = this;
    const events = this.visit.collector.take();
    const { drafts, moduleFailure } = classifyStep({ events, origin });
    if (moduleFailure) this.moduleFailures += 1;
    await this.checkSession();
    const url = this.page.url();
    this.paths.add(normalisePath(url));
    const text = await this.readBody();
    if (text === undefined) this.error ||= "page unresponsive";
    const screen =
      text === undefined
        ? classifyHang({ what: "page unresponsive", url })
        : classifyScreen({ text, url, origin });
    if (moduleFailure) return this.record(drafts, contextOf(events));
    await this.record(screen === undefined ? drafts : [...drafts, screen], contextOf(events));
  }

  private get signedOut(): boolean {
    const onAuth = new URL(this.page.url(), this.origin).pathname.startsWith("/auth/");
    return onAuth && !this.visit.route.startsWith("/auth/");
  }

  /** checkSession retries a route that bounced to sign-in once: a loaded stack drops reads. */
  private async checkSession(): Promise<void> {
    if (!this.signedOut) return;
    await this.visit.side.goto(this.visit.path).catch(() => undefined);
    await this.visit.side.waitUntilQuiet();
    if (this.signedOut) {
      const last = JSON.stringify(this.trail.at(-1));
      throw new SessionLost(`signed out at ${this.page.url()} after ${last}`);
    }
  }

  /** readBody reads the page's text; a blank page gets one more look, for a slow first paint. */
  private async readBody(): Promise<string | undefined> {
    const read = async (): Promise<string | undefined> =>
      bounded<string | undefined>({
        work: this.page.innerText("body"),
        millis: READ_TIMEOUT_MILLIS,
        fallback: undefined,
      });
    const text = await read();
    if (text === undefined || text.trim() !== "") return text;
    await this.page.waitForTimeout(BLANK_RECHECK_MILLIS);
    return read();
  }

  private async record(
    drafts: readonly Draft[],
    context: StepContext = EMPTY_CONTEXT,
  ): Promise<void> {
    for (const draft of drafts) {
      const signature = signatureOf(draft);
      if (BROKEN_ORACLES.has(oracleOf(draft.kind))) this.broken = true;
      if (this.seen.has(signature)) continue;
      this.seen.add(signature);
      const { plan, route, sink } = this.visit;
      const screenshot = await this.photograph(signature);
      sink.write({
        oracle: oracleOf(draft.kind),
        finding: true,
        route: routeLabel(route),
        signature,
        message: draft.message,
        trail: this.trail.map(trailLine),
        evidence: {
          ...(screenshot === undefined ? {} : { screenshot }),
          url: this.page.url(),
          ...context,
        },
        capturedAt: new Date().toISOString(),
        seed: plan.seed,
        visit: this.visit.visit,
        navigation: this.navigation,
      });
      this.findings += 1;
    }
  }

  /** photograph grabs the viewport now and leaves the writing to the sink's background. */
  private async photograph(signature: string): Promise<string | undefined> {
    const { sink } = this.visit;
    if (!sink.wantsScreenshot(signature)) return undefined;
    const bytes = await bounded<Buffer | undefined>({
      work: this.page.screenshot({ animations: "disabled", timeout: READ_TIMEOUT_MILLIS }),
      millis: READ_TIMEOUT_MILLIS,
      fallback: undefined,
    });
    if (bytes === undefined) return undefined;
    const shot = sink.nextShot(this.navigation);
    sink.save({ file: shot.file, bytes });
    return shot.relative;
  }
}

/**
 * walkRoute opens a route and does the plan's number of actions on it. Its rng is seeded from
 * the run seed, the route and the visit, so the same seed replays the same choices whichever
 * worker takes the visit.
 */
export const walkRoute = async (visit: Visit): Promise<VisitResult> => new RouteWalk(visit).run();
