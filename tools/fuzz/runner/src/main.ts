import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  openSideBrowser,
  type Side,
  type SideBrowser,
} from "@langwatch/visual-diff-runner/capture";
import { note, type Plan as CapturePlan } from "@langwatch/visual-diff-runner/protocol";
import { signInSide } from "@langwatch/visual-diff-runner/sign-in";

import { Collector, SessionLost, walkRoute } from "./monkey.ts";
import { planSchema, type Coverage, type FuzzPlan, type Navigation } from "./protocol.ts";
import { hashSeed, mulberry32, shuffled } from "./rng.ts";
import { expandRoute, registeredRoutes, type Expanded } from "./routes.ts";
import { ReloadSchedule } from "./schedule.ts";
import { FindingSink } from "./sink.ts";

const out = process.stdout;
const PROGRESS_MILLIS = 5000;
/** UNBOUNDED_PASSES lets a timed run keep walking until its deadline. */
const UNBOUNDED_PASSES = 1_000_000;
const WATCHDOG_MILLIS = 120_000;
const LANDING_MILLIS = 180_000;

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

/** openPages opens every page while the first signs in: they share the one session. */
const openPages = async ({
  plan,
  outDir,
  browser,
  count,
}: {
  plan: FuzzPlan;
  outDir: string;
  browser: SideBrowser;
  count: number;
}): Promise<Side[]> => {
  const first = await browser.openPage();
  const [, rest] = await Promise.all([
    signInWithRetry({ plan, outDir, side: first }),
    Promise.all(Array.from({ length: count - 1 }, async () => browser.openPage())),
  ]);
  first.page.context().on("page", (popup) => {
    void popup.opener().then((opener) => (opener === null ? undefined : popup.close()));
  });
  return [first, ...rest];
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
  }

  get routesVisited(): number {
    return Object.values(this.perRoute).filter((route) => route.visits > 0).length;
  }

  get total(): number {
    const passes = this.plan.passes ?? (this.plan.durationMs > 0 ? UNBOUNDED_PASSES : 1);
    return this.order.length * passes;
  }

  /** take hands out the next visit, or nothing once the queue, deadline or session is gone. */
  take(): { entry: Expanded; visit: number } | undefined {
    if (this.next >= this.total || Date.now() >= this.deadline || this.sessionLost)
      return undefined;
    const index = this.next++;
    return {
      entry: this.order[index % this.order.length] as Expanded,
      visit: Math.floor(index / this.order.length),
    };
  }

  async lane(side: Side): Promise<void> {
    const collector = new Collector(side.page);
    const schedule = new ReloadSchedule(this.plan.reloadEvery);
    for (let job = this.take(); job !== undefined; job = this.take()) {
      const navigation = schedule.next();
      const outcome = await this.visit({ side, collector, navigation, ...job });
      schedule.done(outcome);
      this.visits += 1;
    }
  }

  private async visit({
    side,
    collector,
    entry,
    visit,
    navigation,
  }: {
    side: Side;
    collector: Collector;
    entry: Expanded;
    visit: number;
    navigation: Navigation;
  }): Promise<{ navigation: Navigation; broken: boolean }> {
    const stats = (this.perRoute[entry.route] ??= { visits: 0, actions: 0, findings: 0 });
    try {
      const result = await walkRoute({
        side,
        collector,
        plan: this.plan,
        sink: this.sink,
        route: entry.route,
        path: entry.path as string,
        visit,
        navigation,
        avoid: this.avoid,
        now: Date.now,
        deadline: this.deadline,
      });
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
    } catch (thrown) {
      if (thrown instanceof SessionLost) this.sessionLost = thrown;
      else stamp(`fuzz: visit ${entry.route} #${visit} failed: ${String(thrown).slice(0, 200)}`);
    }
    return { navigation, broken: true };
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
}): Promise<void> => {
  const outDir = join(runDir, "ui");
  const sink = new FindingSink(runDir);
  const signInStartedAt = Date.now();
  const pages = await openPages({ plan, outDir, browser, count: plan.workers });
  const first = pages[0] as Side;
  const slug = plan.slug ?? (await projectSlug(first));
  const signInMillis = Date.now() - signInStartedAt;
  const expanded = (plan.routes ?? registeredRoutes())
    .filter((route) => !plan.only || route.includes(plan.only))
    .map((route) => expandRoute({ route, slug, fixtures: plan.fixtures ?? {} }));
  const order = shuffled({
    rng: mulberry32(hashSeed([plan.seed, "routes"])),
    items: expanded.filter((entry) => entry.path !== undefined),
  });
  stamp(
    `fuzz: signed in (${signInMillis}ms), ${pages.length} pages, ${order.length}/${expanded.length} routes`,
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
  await Promise.all(pages.map(async (side) => run.lane(side)));
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
};

const main = async (): Promise<void> => {
  const { plan, runDir } = readPlan(process.argv.slice(2));
  const browser = await openSideBrowser({
    side: { name: "fuzz", baseUrl: plan.url },
    viewport: plan.viewport,
    settle: plan.settle,
  });
  try {
    await walk({ plan, runDir, browser });
  } finally {
    await browser.close();
  }
};

const code = await main().then(
  () => 0,
  (thrown: unknown) => {
    stamp(`fuzz: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    return 1;
  },
);
out.write("", () => process.exit(code));
