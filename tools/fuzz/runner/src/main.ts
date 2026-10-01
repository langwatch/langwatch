import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  openSideBrowser,
  type Side,
  type SideBrowser,
} from "@langwatch/visual-diff-runner/capture";
import { note, type Plan as CapturePlan } from "@langwatch/visual-diff-runner/protocol";
import { Throttle } from "@langwatch/visual-diff-runner/schedule";
import { signInSide } from "@langwatch/visual-diff-runner/sign-in";

import { Collector, SessionLost, walkRoute, type VisitResult } from "./monkey.ts";
import { planSchema, type Coverage, type FuzzPlan, type Navigation } from "./protocol.ts";
import { hashSeed, mulberry32, shuffled } from "./rng.ts";
import { expandRoute, registeredRoutes, type Expanded } from "./routes.ts";
import { loadingScale, ReloadSchedule, takeOnceMore } from "./schedule.ts";
import { FindingSink, HeldFindings } from "./sink.ts";
import { ErrorStreak } from "./streak.ts";

const out = process.stdout;
const PROGRESS_MILLIS = 5000;
/** UNBOUNDED_PASSES lets a timed run keep walking until its deadline. */
const UNBOUNDED_PASSES = 1_000_000;
const WATCHDOG_MILLIS = 120_000;
const LANDING_MILLIS = 180_000;
/** STOPPED_EXIT is the exit code of a run that stopped early on purpose (the Go side reads it). */
const STOPPED_EXIT = 3;
const REASON_CHARS = 200;
/** PAUSE_MILLIS is how often a lane over the throttle asks again whether it may work. */
const PAUSE_MILLIS = 1000;

const firstLine = (thrown: unknown): string =>
  String(thrown instanceof Error ? thrown.message : thrown)
    .split("\n")[0]
    ?.slice(0, REASON_CHARS) ?? "";

/** SetupFailed is a failure of the runner's own setup: the browser, sign-in or the landing page. */
class SetupFailed extends Error {}

/** setup runs one setup step; its failure stops the run before any visit. */
const setup = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (thrown) {
    throw new SetupFailed(`stopping: setup failed: ${firstLine(thrown)}`);
  }
};

const stamp = (text: string): void =>
  note({ text: `[${new Date().toTimeString().slice(0, 8)}] ${text}`, err: process.stderr });

const flag = ({ argv, name }: { argv: string[]; name: string }): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const readPlan = (argv: string[]): { plan: FuzzPlan; runDir: string } => {
  const file = flag({ argv, name: "--plan" });
  if (file === undefined) throw new Error("usage: fuzz --plan <plan.json> [--out <run dir>]");
  const plan = planSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  return { plan, runDir: flag({ argv, name: "--out" }) ?? dirname(file) };
};

/** capturePlan is the shape visualdiff's sign-in reads; the routes and flows are not used. */
const capturePlan = ({ plan, outDir }: { plan: FuzzPlan; outDir: string }): CapturePlan => ({
  viewport: plan.viewport,
  settle: plan.settle,
  sides: [{ name: "fuzz", baseUrl: plan.url }],
  outDir,
  slug: plan.slug ?? "",
  routes: [],
  flows: [],
  credential: {
    projectKey: "",
    email: plan.credential.email,
    password: plan.credential.password,
    slug: plan.slug ?? "",
    fallbackEmails: plan.credential.fallbackEmails ?? [],
  },
});

const SIGN_IN_ATTEMPTS = 3;

/** signInWithRetry tries again: a dev UI that is still compiling misses the sign-in form once. */
const signInWithRetry = async ({
  plan,
  outDir,
  side,
}: {
  plan: FuzzPlan;
  outDir: string;
  side: Side;
}): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await signInSide({
        plan: capturePlan({ plan, outDir }),
        side,
        collect: () => undefined,
      });
    } catch (thrown) {
      if (attempt >= SIGN_IN_ATTEMPTS) throw thrown;
      stamp(`fuzz: sign-in attempt ${attempt} failed, trying again`);
    }
  }
};

/** closePopups closes the tabs an action opens in a context. */
const closePopups = (side: Side): void => {
  side.page.context().on("page", (popup) => {
    void popup.opener().then((opener) => (opener === null ? undefined : popup.close()));
  });
};

/** signIn signs the first page in; every visit's context then copies its session. */
const signIn = async ({
  plan,
  outDir,
  browser,
}: {
  plan: FuzzPlan;
  outDir: string;
  browser: SideBrowser;
}): Promise<Side> => {
  const first = await browser.openPage();
  await signInWithRetry({ plan, outDir, side: first });
  return first;
};

/** projectSlug is the address `/` lands on once signed in: the user's first project. */
const projectSlug = async (side: Side): Promise<string> => {
  await side.goto("/");
  // `/` redirects only once organization.getAll answers: tens of seconds for a busy admin.
  await side.page
    .waitForURL((url) => url.pathname !== "/", { timeout: LANDING_MILLIS })
    .catch(() => undefined);
  await side.waitUntilQuiet();
  const [slug = ""] = new URL(side.page.url()).pathname.split("/").filter(Boolean);
  if (slug === "" || ["auth", "onboarding"].includes(slug)) {
    throw new Error(`no project to fuzz: signed in, but "/" lands on ${side.page.url()}`);
  }
  return slug;
};

/** visitsLine is visits/total on a pass-bounded run; a timed run's total is only a queue bound. */
const visitsLine = ({ run, deadline }: { run: Run; deadline: number }): string => {
  const kinds = `(${run.reloads} reload, ${run.inAppVisits} in-app)`;
  if (!Number.isFinite(deadline)) return `visits ${run.visits}/${run.total} ${kinds}`;
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  const clock = `${Math.floor(left / 60)}m${String(left % 60).padStart(2, "0")}s`;
  return `visits ${run.visits} ${kinds} routes ${run.routesVisited}/${run.order.length} left ${clock}`;
};

/** LanePage is a lane's page, in a context of its own, and what listens to it. */
interface LanePage {
  side: Side;
  collector: Collector;
}

/** Walked is a visit's result, or what it threw. */
interface Walked {
  result?: VisitResult;
  thrown?: unknown;
}

/** Attempt is one try at a visit: what it found, held back, and whether the page crashed. */
interface Attempt {
  walked: Walked;
  held: HeldFindings;
  crashed: boolean;
  navigation: Navigation;
}

const openLanePage = async (browser: SideBrowser): Promise<LanePage> => {
  const side = await browser.openLane();
  closePopups(side);
  return { side, collector: new Collector(side.page) };
};

/** Run is the state the lanes share: the queue of visits and what they have done so far. */
class Run {
  readonly perRoute: Coverage["perRoute"] = {};
  readonly paths = new Set<string>();
  visits = 0;
  actions = 0;
  moduleFailures = 0;
  reloads = 0;
  inAppVisits = 0;
  navigationFallbacks = 0;
  sessionLost: SessionLost | undefined;
  readonly streak: ErrorStreak;
  readonly throttle: Throttle;
  private next = 0;

  readonly plan: FuzzPlan;
  readonly order: readonly Expanded[];
  readonly sink: FindingSink;
  readonly avoid: readonly RegExp[];
  readonly deadline: number;

  constructor(input: {
    plan: FuzzPlan;
    order: readonly Expanded[];
    sink: FindingSink;
    avoid: readonly RegExp[];
    deadline: number;
  }) {
    this.plan = input.plan;
    this.order = input.order;
    this.sink = input.sink;
    this.avoid = input.avoid;
    this.deadline = input.deadline;
    this.streak = new ErrorStreak(input.plan.maxConsecutiveErrors);
    this.throttle = new Throttle("fuzz", input.plan.workers);
  }

  get routesVisited(): number {
    return Object.values(this.perRoute).filter((route) => route.visits > 0).length;
  }

  get total(): number {
    const passes = this.plan.passes ?? (this.plan.durationMs > 0 ? UNBOUNDED_PASSES : 1);
    return this.order.length * passes;
  }

  private get exhausted(): boolean {
    return (
      this.next >= this.total ||
      Date.now() >= this.deadline ||
      this.sessionLost !== undefined ||
      this.streak.stopped !== undefined
    );
  }

  /** take hands out the next visit, or nothing once the queue, deadline or session is gone. */
  take(): { entry: Expanded; visit: number } | undefined {
    if (this.exhausted) return undefined;
    const index = this.next++;
    return {
      entry: this.order[index % this.order.length] as Expanded,
      visit: Math.floor(index / this.order.length),
    };
  }

  /** lane works visits on pages of its own: a lane over the throttle's limit waits. */
  async lane({ browser, index }: { browser: SideBrowser; index: number }): Promise<void> {
    const schedule = new ReloadSchedule(this.plan.reloadEvery);
    let page: LanePage | undefined;
    while (!this.exhausted) {
      if (index > 0 && index >= this.throttle.limit()) {
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MILLIS));
        continue;
      }
      const job = this.take();
      if (job === undefined) break;
      const navigation = schedule.next();
      const attempt = async (n: number): Promise<Attempt> => {
        const how = n === 0 ? navigation : "reload";
        if (how === "reload" || page === undefined) {
          await page?.side.dispose();
          page = await openLanePage(browser);
        }
        const held = new HeldFindings(this.sink);
        const walked = await this.walk({ ...page, sink: held, navigation: how, ...job });
        return { walked, held, crashed: page.side.crashed, navigation: how };
      };
      const taken = await takeOnceMore({
        take: attempt,
        crashed: (result) => result.crashed,
        onCrash: () => this.throttle.crashed(),
      });
      if (taken.crashed) {
        await page?.side.dispose();
        page = undefined;
      }
      schedule.done(this.account({ ...job, taken }));
      this.visits += 1;
    }
    await page?.side.dispose();
  }

  private async walk({
    side,
    collector,
    sink,
    entry,
    visit,
    navigation,
  }: LanePage & {
    sink: HeldFindings;
    entry: Expanded;
    visit: number;
    navigation: Navigation;
  }): Promise<Walked> {
    try {
      const result = await walkRoute({
        side,
        collector,
        plan: this.plan,
        sink,
        loadingScale: () => loadingScale({ max: this.plan.workers, limit: this.throttle.limit() }),
        route: entry.route,
        path: entry.path as string,
        visit,
        navigation,
        avoid: this.avoid,
        // A stopped run ends its in-flight visits at their next action.
        now: () => (this.streak.stopped === undefined ? Date.now() : Number.POSITIVE_INFINITY),
        deadline: this.deadline,
      });
      return { result };
    } catch (thrown) {
      if (thrown instanceof SessionLost) this.sessionLost = thrown;
      return { thrown };
    }
  }

  /** account counts a visit and releases its findings; a visit that crashed twice counts none. */
  private account({ entry, visit, taken }: { entry: Expanded; visit: number; taken: Attempt }): {
    navigation: Navigation;
    broken: boolean;
  } {
    const { walked, navigation } = taken;
    const stats = (this.perRoute[entry.route] ??= { visits: 0, actions: 0, findings: 0 });
    if (taken.crashed) {
      stamp(`fuzz: visit ${entry.route} #${visit} crashed the page twice, not a finding`);
      this.streak.record("page crashed");
      return { navigation, broken: true };
    }
    taken.held.release();
    if (walked.result === undefined) {
      if (!(walked.thrown instanceof SessionLost)) {
        stamp(
          `fuzz: visit ${entry.route} #${visit} failed: ${String(walked.thrown).slice(0, 200)}`,
        );
        this.streak.record(firstLine(walked.thrown));
      }
      return { navigation, broken: true };
    }
    const { result } = walked;
    this.streak.record(result.error);
    stats.visits += 1;
    stats.actions += result.actions;
    stats.findings += result.findings;
    this.actions += result.actions;
    this.moduleFailures += result.moduleFailures;
    for (const seen of result.paths) this.paths.add(seen);
    if (result.navigation === "reload") this.reloads += 1;
    else this.inAppVisits += 1;
    if (result.fellBack) this.navigationFallbacks += 1;
    return result;
  }
}

const coverageOf = ({
  run,
  expanded,
  timing,
}: {
  run: Run;
  expanded: Expanded[];
  timing: Pick<Coverage, "signInMillis" | "walkMillis">;
}): Coverage => ({
  ...timing,
  routesTotal: expanded.length,
  routesVisited: run.routesVisited,
  routesSkipped: expanded.flatMap((entry) =>
    entry.skipped === undefined ? [] : [{ route: entry.route, reason: entry.skipped }],
  ),
  visits: run.visits,
  actions: run.actions,
  moduleFailures: run.moduleFailures,
  reloads: run.reloads,
  inAppVisits: run.inAppVisits,
  navigationFallbacks: run.navigationFallbacks,
  pathsSeen: [...run.paths].toSorted(),
  perRoute: run.perRoute,
});

const walk = async ({
  plan,
  runDir,
  browser,
}: {
  plan: FuzzPlan;
  runDir: string;
  browser: SideBrowser;
}): Promise<string | undefined> => {
  const outDir = join(runDir, "ui");
  const sink = new FindingSink(runDir);
  const signInStartedAt = Date.now();
  const first = await setup(async () => signIn({ plan, outDir, browser }));
  const slug = plan.slug ?? (await setup(async () => projectSlug(first)));
  const signInMillis = Date.now() - signInStartedAt;
  const expanded = (plan.routes ?? registeredRoutes())
    .filter((route) => !plan.only || route.includes(plan.only))
    .map((route) => expandRoute({ route, slug, fixtures: plan.fixtures ?? {} }));
  const order = shuffled({
    rng: mulberry32(hashSeed([plan.seed, "routes"])),
    items: expanded.filter((entry) => entry.path !== undefined),
  });
  stamp(
    `fuzz: signed in (${signInMillis}ms), ${plan.workers} pages, ${order.length}/${expanded.length} routes`,
  );

  const walkStartedAt = Date.now();
  const deadline = plan.durationMs > 0 ? walkStartedAt + plan.durationMs : Number.POSITIVE_INFINITY;
  const run = new Run({
    plan,
    order,
    sink,
    avoid: (plan.avoid ?? []).map((source) => new RegExp(source, "i")),
    deadline,
  });
  const progress = setInterval(() => {
    stamp(
      `fuzz: ${visitsLine({ run, deadline })} actions ${run.actions} findings ${sink.findings} distinct ${sink.distinct}`,
    );
  }, PROGRESS_MILLIS);
  const watchdog =
    plan.durationMs > 0
      ? setTimeout(() => {
          stamp("fuzz: watchdog: visits outlasted the deadline, leaving with what was found");
          sink.complete({ routesExercised: run.routesVisited, routesTotal: expanded.length });
          void sink.flush().then(() => process.exit(2));
        }, plan.durationMs + WATCHDOG_MILLIS)
      : undefined;
  await Promise.all(
    Array.from({ length: plan.workers }, async (_, index) => run.lane({ browser, index })),
  );
  clearInterval(progress);
  clearTimeout(watchdog);

  const timing = { signInMillis, walkMillis: Date.now() - walkStartedAt };
  const coverage = coverageOf({ run, expanded, timing });
  await sink.flush();
  await writeFile(join(outDir, "coverage.json"), JSON.stringify(coverage, null, 2));
  sink.complete({ routesExercised: coverage.routesVisited, routesTotal: coverage.routesTotal });
  await sink.flush();
  stamp(
    `fuzz: done in ${timing.walkMillis}ms: ${coverage.routesVisited}/${coverage.routesTotal} routes, ${run.reloads} reloads, ${run.inAppVisits} in-app (${run.navigationFallbacks} fell back), ${run.actions} actions, ${sink.findings} findings (${sink.distinct} distinct)`,
  );
  if (run.sessionLost !== undefined) throw run.sessionLost;
  return run.streak.stopped;
};

const main = async (): Promise<number> => {
  const { plan, runDir } = readPlan(process.argv.slice(2));
  const browser = await setup(async () =>
    openSideBrowser({
      side: { name: "fuzz", baseUrl: plan.url },
      viewport: plan.viewport,
      settle: plan.settle,
      // The fuzzer judges behaviour, never pixels.
      fast: true,
    }),
  );
  try {
    const stopped = await walk({ plan, runDir, browser });
    if (stopped === undefined) return 0;
    note({ text: `fuzz ui: ${stopped}`, err: process.stderr });
    return STOPPED_EXIT;
  } finally {
    await browser.close();
  }
};

const code = await main().catch((thrown: unknown) => {
  if (thrown instanceof SetupFailed)
    note({ text: `fuzz ui: ${thrown.message}`, err: process.stderr });
  else stamp(`fuzz: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  return 1;
});
out.write("", () => process.exit(code));
