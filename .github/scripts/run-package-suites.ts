// Runs every workspace package's own test suite, discovered from pnpm's
// workspace membership rather than from a hand-written list that reached
// seventeen of a hundred and sixty before this replaced it.
// Spec: specs/ci/package-suite-integration-lane.feature, specs/ci/browser-test-lane.feature

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface RegisterEntry {
  name: string;
  reason: string;
}

export interface PackageManifestScripts {
  [script: string]: string;
}

export interface DiscoveredPackage {
  name: string;
  dir: string;
  /** Every script this package declares that the gate runs, in order. */
  scripts: string[];
}

export interface SuiteOutcome {
  name: string;
  outcome: "passed" | "failed" | "skipped";
  /** The first script that failed, for the message. */
  failedScript?: string;
  /** Why it was skipped, from the register. */
  reason?: string;
}

/**
 * `test:unit` wins over `test` — the same suite under two names. The other two
 * are additional lanes, not alternatives: preferring one and stopping is how
 * four of `@langwatch/trace-process`'s suites ran in no job at all, reading green.
 */
export const scriptsFor = (scripts: PackageManifestScripts): string[] => {
  const chosen: string[] = [];
  if (scripts["test:unit"]) chosen.push("test:unit");
  else if (scripts.test) chosen.push("test");
  if (scripts["test:integration"]) chosen.push("test:integration");
  if (scripts["test:browser"]) chosen.push("test:browser");
  return chosen;
};

/**
 * Parses one register. A line is `<package>  # <reason>`; the reason is
 * MANDATORY, because an unexplained entry is how a register stops being
 * reviewable.
 */
export const parseRegister = (
  source: string,
  file: string,
): { entries: RegisterEntry[]; errors: string[] } => {
  const entries: RegisterEntry[] = [];
  const errors: string[] = [];
  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const hash = line.indexOf("#");
    const name = (hash === -1 ? line : line.slice(0, hash)).trim();
    const reason = hash === -1 ? "" : line.slice(hash + 1).trim();
    if (name === "" || reason === "") {
      errors.push(
        `::error file=${file},line=${index + 1}::'${line}' is not '<package>  # why it is here'.`,
      );
      return;
    }
    entries.push({ name, reason });
  });
  return { entries, errors };
};

/**
 * A register entry naming a package the workspace no longer has is dead weight
 * that reads as coverage. Renames are the usual cause.
 */
export const staleEntries = (entries: RegisterEntry[], discovered: string[]): string[] =>
  entries.filter((entry) => !discovered.includes(entry.name)).map((entry) => entry.name);

export interface PnpmProject {
  name?: string;
  path?: string;
}

export const discover = (projects: PnpmProject[], root: string): DiscoveredPackage[] => {
  const found: DiscoveredPackage[] = [];
  for (const project of projects) {
    if (!project.path || !project.name) continue;
    if (resolve(project.path) === resolve(root)) continue;
    const manifestPath = join(project.path, "package.json");
    if (!existsSync(manifestPath)) continue;
    const scripts = (JSON.parse(readFileSync(manifestPath, "utf8")).scripts ??
      {}) as PackageManifestScripts;
    const chosen = scriptsFor(scripts);
    if (chosen.length === 0) continue;
    found.push({ name: project.name, dir: relative(root, project.path), scripts: chosen });
  }
  return found.toSorted((a, b) => a.name.localeCompare(b.name));
};

/**
 * Parses `PACKAGE_SUITES_SHARD` (`<index>/<total>`, 1-based). Absent means one
 * shard holding everything; a malformed value is an error, never a silent
 * whole run on every leg.
 */
export const parseShard = (value: string | undefined): { index: number; total: number } => {
  if (value === undefined || value === "") return { index: 1, total: 1 };
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const index = match ? Number(match[1]) : Number.NaN;
  const total = match ? Number(match[2]) : Number.NaN;
  if (!(index >= 1 && total >= 1 && index <= total)) {
    throw new Error(
      `PACKAGE_SUITES_SHARD='${value}' is not '<index>/<total>' with 1 <= index <= total.`,
    );
  }
  return { index, total };
};

/**
 * Parses `PACKAGE_SUITES_ONLY`, the JSON list of projects a pull request reaches
 * (from `nx show projects --affected`). Absent means every package; a malformed
 * value is an error, never a silent whole run or an empty one.
 */
export const parseOnly = (value: string | undefined): Set<string> | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === "string")) {
    throw new Error(`PACKAGE_SUITES_ONLY is not a JSON list of project names: '${value}'.`);
  }
  return new Set(parsed);
};

/**
 * A package at least this slow runs alone on its shard: design-system's story
 * tests time out under any CPU sharing, even beside one light suite.
 */
export const HEAVY_SECONDS = 100;

/** Heaviest first, so a long suite is not the last one left running alone. */
export const heaviestFirst = ({
  packages,
  weightOf,
}: {
  packages: readonly DiscoveredPackage[];
  weightOf: (pkg: DiscoveredPackage) => number;
}): DiscoveredPackage[] =>
  packages.toSorted((a, b) => weightOf(b) - weightOf(a) || a.name.localeCompare(b.name));

/** Whether a package's recorded weight puts it in the shard-wide heavy slot. */
export const isHeavyPackage = ({
  weightOf,
  pkg,
}: {
  weightOf: (pkg: DiscoveredPackage) => number;
  pkg: DiscoveredPackage;
}): boolean => weightOf(pkg) >= HEAVY_SECONDS;

/** What a shard's packages add up to, per way they run. */
export interface ShardLoad {
  /** Heavy packages, which run alone. */
  alone: number;
  /** Every light suite, which shares the shard's concurrency slots. */
  shared: number;
  /** Light integration and browser suites, each lane one suite at a time. */
  integration: number;
  browser: number;
}

const EMPTY_LOAD: ShardLoad = { alone: 0, shared: 0, integration: 0, browser: 0 };

/**
 * A shard's wall time, which is what the split balances. A heavy package runs
 * alone and adds all of its weight. Light suites share `concurrency` slots, but
 * the integration and browser lanes each run one suite at a time, so the light
 * part takes whichever is longest. Splitting by raw weight, a shard holding 737s
 * of heavy suites ran 1073s while one holding 211s ran 473s.
 */
export const wallTimeOf = ({ load, concurrency }: { load: ShardLoad; concurrency: number }) =>
  load.alone + Math.max(load.shared / concurrency, load.integration, load.browser);

/**
 * `load` with one package added. The weights file records a package, not its
 * scripts, so a light package's weight is spread evenly over its scripts' lanes.
 */
export const withPackage = ({
  load,
  weight,
  scripts,
}: {
  load: ShardLoad;
  weight: number;
  scripts: readonly string[];
}): ShardLoad => {
  if (weight >= HEAVY_SECONDS) return { ...load, alone: load.alone + weight };
  const next = { ...load, shared: load.shared + weight };
  for (const script of scripts) {
    const lane = laneOf(script);
    if (lane !== "shared") next[lane] += weight / scripts.length;
  }
  return next;
};

/**
 * Splits packages into `total` groups, heaviest first, each onto the group whose
 * wall time it raises least. Every shard computes this alone, so ties break on
 * name then lowest group: the answers must agree exactly or a package runs twice
 * or not at all.
 */
export const balanceByWallTime = <T extends { name: string; scripts: readonly string[] }>({
  items,
  weightOf,
  concurrency,
  total,
}: {
  items: readonly T[];
  weightOf: (item: T) => number;
  concurrency: number;
  total: number;
}): { groups: T[][]; walls: number[] } => {
  const loads: ShardLoad[] = Array.from({ length: total }, () => ({ ...EMPTY_LOAD }));
  const groupOf = new Map<string, number>();
  const byWeight = items
    .map((item) => ({ item, weight: weightOf(item) }))
    .toSorted((a, b) => b.weight - a.weight || a.item.name.localeCompare(b.item.name));
  for (const { item, weight } of byWeight) {
    const candidates = loads.map((load) => withPackage({ load, weight, scripts: item.scripts }));
    const walls = candidates.map((load) => wallTimeOf({ load, concurrency }));
    const best = walls.indexOf(Math.min(...walls));
    groupOf.set(item.name, best);
    loads[best] = candidates[best]!;
  }
  return {
    groups: loads.map((_, group) => items.filter((item) => groupOf.get(item.name) === group)),
    walls: loads.map((load) => wallTimeOf({ load, concurrency })),
  };
};

/** Seconds a package costs when the weights file does not name it. */
export const DEFAULT_WEIGHT_SECONDS = 5;

/**
 * Parses the weights file. A line is `<package>  <seconds>`, optionally followed
 * by `# note`. A bad line is an error: one that silently parsed to nothing would
 * put the split back to guessing.
 */
export const parseWeights = (
  source: string,
  file: string,
): { weights: Map<string, number>; errors: string[] } => {
  const weights = new Map<string, number>();
  const errors: string[] = [];
  source.split("\n").forEach((raw, index) => {
    const line = (raw.includes("#") ? raw.slice(0, raw.indexOf("#")) : raw).trim();
    if (line === "") return;
    const match = /^(\S+)\s+(\d+(?:\.\d+)?)$/.exec(line);
    const seconds = match ? Number(match[2]) : Number.NaN;
    if (!match || !Number.isFinite(seconds) || seconds <= 0 || weights.has(match[1])) {
      errors.push(
        `::error file=${file},line=${index + 1}::'${line}' is not '<package>  <seconds>' with a positive number, once per package.`,
      );
      return;
    }
    weights.set(match[1], seconds);
  });
  return { weights, errors };
};

/**
 * The nightly flaky-test hunt names each package suite's JSON report after the
 * package and script, so the report alone says what to rerun. `:` is not allowed
 * in an artifact path, so a script's colon is written as `~`.
 */
export const reportFileName = ({ pkg, script }: { pkg: string; script: string }): string =>
  `${encodeURIComponent(pkg)}__${script.replaceAll(":", "~")}.json`;

export const parseReportFileName = (name: string): { pkg: string; script: string } | undefined => {
  const match = /^(.+)__([^_]+(?:_[^_]+)*)\.json$/.exec(name);
  if (!match) return undefined;
  return { pkg: decodeURIComponent(match[1]), script: match[2].replaceAll("~", ":") };
};

/**
 * A script's extra arguments in the flaky-test hunt, or undefined when its last command is not
 * `vitest run`: pnpm appends arguments to a script's end, so only one ending in vitest can
 * take them, and any other is not run in the hunt. dev/docs/nightly-suite.md.
 */
export const vitestArgsFor = ({
  body,
  extra,
  reportFile,
}: {
  body: string;
  extra: string[];
  reportFile?: string;
}): string[] | undefined => {
  const last =
    body
      .split(/&&|;|\|\|/)
      .at(-1)
      ?.trim() ?? "";
  if (!/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)*vitest\s+run\b/.test(last)) return undefined;
  const report = reportFile
    ? ["--reporter=default", "--reporter=json", `--outputFile.json=${reportFile}`]
    : [];
  return [...extra, ...report];
};

/** One script of one package: the unit the pool schedules. */
export interface SuiteJob {
  pkg: DiscoveredPackage;
  script: string;
}

/**
 * The lanes that may not overlap across packages. Integration files run
 * serially against one shared datastore; a browser lane installs Chromium
 * through apt, which holds a machine-wide lock. Everything else is `shared`.
 */
const LANES: Record<string, "integration" | "browser"> = {
  "test:integration": "integration",
  "test:browser": "browser",
};
export const laneOf = (script: string): "integration" | "browser" | "shared" =>
  LANES[script] ?? "shared";

/**
 * Packages whose suites keep the launcher's two workers even with the shard to
 * themselves: design-system's story tests time out under any CPU sharing, and
 * more workers in one suite is sharing too.
 */
export const KEEPS_LAUNCHER_WORKERS: ReadonlySet<string> = new Set(["@langwatch/design-system"]);

/**
 * What a job adds to its environment. A heavy unit suite runs alone, so it takes
 * every core rather than the launcher's two. Integration and browser lanes keep
 * their own counts: their files share a datastore or an apt lock.
 */
export const workerEnvFor = ({
  job,
  heavy,
  cores,
}: {
  job: SuiteJob;
  heavy: boolean;
  cores: number;
}): Record<string, string> =>
  heavy && cores > 2 && laneOf(job.script) === "shared" && !KEEPS_LAUNCHER_WORKERS.has(job.pkg.name)
    ? { VITEST_MAX_WORKERS: String(cores) }
    : {};

/** The scripts nx.json caches. They run through Nx, so an unchanged suite replays its pass. */
const CACHED_SCRIPTS = new Set(["test", "test:unit"]);

/** The pnpm arguments that run a job; dependencies are built by an earlier step. */
export const commandFor = (job: SuiteJob): string[] =>
  CACHED_SCRIPTS.has(job.script)
    ? [
        "exec",
        "nx",
        "run-many",
        "--targets",
        job.script,
        "--projects",
        job.pkg.name,
        "--excludeTaskDependencies",
        "--outputStyle=stream-without-prefixes",
      ]
    : ["--filter", job.pkg.name, "run", job.script];

/**
 * Parses `PACKAGE_SUITES_CONCURRENCY`. Absent means one suite at a time; a
 * malformed value is an error, never a silent guess.
 */
export const parseConcurrency = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "") return 1;
  const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!(parsed >= 1)) {
    throw new Error(`PACKAGE_SUITES_CONCURRENCY='${value}' is not a positive whole number.`);
  }
  return parsed;
};

/** Every script the gate runs, package by package; an excluded package has none. */
export const jobsFor = (
  packages: readonly DiscoveredPackage[],
  excluded: Map<string, string>,
): SuiteJob[] =>
  packages
    .filter((pkg) => !excluded.has(pkg.name))
    .flatMap((pkg) => pkg.scripts.map((script) => ({ pkg, script })));

/** Starts queued jobs, in order where it can, until the pool is full or none can start. */
const startReady = ({
  queue,
  concurrency,
  running,
  startable,
  start,
}: {
  queue: SuiteJob[];
  concurrency: number;
  running: Set<Promise<void>>;
  startable: (job: SuiteJob) => boolean;
  start: (job: SuiteJob) => void;
}) => {
  let index = queue.findIndex(startable);
  while (running.size < concurrency && index !== -1) {
    start(queue.splice(index, 1)[0]!);
    index = queue.findIndex(startable);
  }
};

/**
 * Runs every job, at most `concurrency` at once, in order where it can. A package
 * runs one script at a time, `integration` and `browser` hold one slot each, and a
 * heavy job runs alone. Every job runs even after one fails.
 */
export const runJobs = async ({
  jobs,
  concurrency,
  run,
  isHeavy = () => false,
}: {
  jobs: readonly SuiteJob[];
  concurrency: number;
  run: (job: SuiteJob) => Promise<number>;
  isHeavy?: (pkg: DiscoveredPackage) => boolean;
}): Promise<Map<SuiteJob, number>> => {
  const statuses = new Map<SuiteJob, number>();
  const queue = [...jobs];
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  const start = (job: SuiteJob) => {
    const keys = keysOf(job, isHeavy);
    for (const key of keys) busy.add(key);
    const settled: Promise<void> = run(job)
      .catch(() => 1)
      .then((status) => {
        statuses.set(job, status);
        for (const key of keys) busy.delete(key);
        running.delete(settled);
      });
    running.add(settled);
  };
  const startable = (job: SuiteJob) =>
    canStart({ job, queue, busy, running: running.size, isHeavy });
  while (queue.length > 0 || running.size > 0) {
    startReady({ queue, concurrency, running, startable, start });
    await Promise.race(running);
  }
  return statuses;
};

/** The shard-wide keys a job holds while it runs: its package, its lane, and heavy. */
const keysOf = (job: SuiteJob, isHeavy: (pkg: DiscoveredPackage) => boolean): string[] => {
  const lane = laneOf(job.script);
  return [
    `package:${job.pkg.name}`,
    ...(lane === "shared" ? [] : [lane]),
    ...(isHeavy(job.pkg) ? ["heavy"] : []),
  ];
};

/** Only a package's earliest queued script may start, so its lanes keep their order. */
const isEarliest = (job: SuiteJob, queue: readonly SuiteJob[]) =>
  queue.find((queued) => queued.pkg.name === job.pkg.name) === job;

/**
 * Whether `job` may start now. A heavy job waits for the shard to drain; while one
 * runs or waits as its package's next script, nothing light starts.
 */
const canStart = ({
  job,
  queue,
  busy,
  running,
  isHeavy,
}: {
  job: SuiteJob;
  queue: readonly SuiteJob[];
  busy: ReadonlySet<string>;
  running: number;
  isHeavy: (pkg: DiscoveredPackage) => boolean;
}): boolean => {
  if (!isEarliest(job, queue)) return false;
  if (isHeavy(job.pkg)) return running === 0;
  const heavyWaiting = queue.some((queued) => isHeavy(queued.pkg) && isEarliest(queued, queue));
  return !heavyWaiting && keysOf(job, isHeavy).every((key) => !busy.has(key)) && !busy.has("heavy");
};

/** A package's single verdict from its scripts' exit codes. */
export const outcomeOf = (
  pkg: DiscoveredPackage,
  excluded: Map<string, string>,
  statusOf: (script: string) => number,
): SuiteOutcome => {
  const reason = excluded.get(pkg.name);
  if (reason !== undefined) return { name: pkg.name, outcome: "skipped", reason };
  // The first failing script in declared order is what the package is blamed on.
  const failedScript = pkg.scripts.find((script) => statusOf(script) !== 0);
  return failedScript === undefined
    ? { name: pkg.name, outcome: "passed" }
    : { name: pkg.name, outcome: "failed", failedScript };
};

/** A started script as the runner sees it: its two output streams, and its end. */
export interface ScriptProcess {
  stdout: { on(event: "data", listener: (chunk: Buffer) => void): unknown } | null;
  stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown } | null;
  on(event: "error", listener: (error?: unknown) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

/**
 * Starts each job's script and settles with its exit code. Live, the output
 * streams straight through; otherwise it is held and printed as one group when
 * the script ends, so two suites never interleave.
 */
export const createSuiteRunner = ({
  live,
  start,
  log,
  write,
  now = Date.now,
}: {
  live: boolean;
  start: (job: SuiteJob) => ScriptProcess;
  log: (line: string) => void;
  write: (output: Buffer) => void;
  now?: () => number;
}) => {
  const unfinished = new Map<SuiteJob, { title: string; chunks: Buffer[] }>();
  const report = (job: SuiteJob, title: string, chunks: Buffer[], startedAt: number) => {
    // Absent once flushed on cancellation: its output is printed already.
    const pending = unfinished.delete(job);
    const seconds = (now() - startedAt) / 1000;
    if (live) log("::endgroup::");
    else if (pending)
      printGroup({ log, write, header: `${title} (${Math.round(seconds)}s)`, chunks });
  };
  const run = (job: SuiteJob): Promise<number> =>
    new Promise((settle) => {
      const startedAt = now();
      const title = `${job.pkg.name} (${job.pkg.dir}) — pnpm run ${job.script}`;
      log(live ? `::group::${title}` : `started: ${title}`);
      const chunks: Buffer[] = [];
      if (!live) unfinished.set(job, { title, chunks });
      const finish = once((status: number) => {
        report(job, title, chunks, startedAt);
        settle(status);
      });
      const say = (line: string) => (live ? log(line) : chunks.push(Buffer.from(`${line}\n`)));
      watchScript({ job, start, chunks, say, finish });
    });
  /** What the scripts still running have printed so far, for a cancelled run. */
  const flushUnfinished = () => {
    for (const [job, { title, chunks }] of unfinished) {
      unfinished.delete(job);
      printGroup({ log, write, header: `${title} (unfinished)`, chunks });
    }
  };
  return { run, flushUnfinished };
};

const printGroup = ({
  log,
  write,
  header,
  chunks,
}: {
  log: (line: string) => void;
  write: (output: Buffer) => void;
  header: string;
  chunks: Buffer[];
}) => {
  log(`::group::${header}`);
  write(Buffer.concat(chunks));
  log("::endgroup::");
};

/** Starts a job's script and settles `finish` with its exit code, saying why if it never ran. */
const watchScript = ({
  job,
  start,
  chunks,
  say,
  finish,
}: {
  job: SuiteJob;
  start: (job: SuiteJob) => ScriptProcess;
  chunks: Buffer[];
  say: (line: string) => unknown;
  finish: (status: number) => void;
}) => {
  const failToStart = (error: unknown) => {
    say(`could not start pnpm run ${job.script}: ${String(error)}`);
    finish(1);
  };
  const started = startSafely(() => start(job));
  if ("error" in started) return failToStart(started.error);
  collectOutput(started.child, chunks);
  started.child.on("error", failToStart);
  started.child.on("close", (code: number | null) => finish(code ?? 1));
};

/** Calls `fn` the first time only: a process can report an error and then close. */
const once = <T>(fn: (value: T) => void) => {
  let called = false;
  return (value: T) => {
    if (called) return;
    called = true;
    fn(value);
  };
};

/** The started process, or what starting it threw. */
const startSafely = (start: () => ScriptProcess): { child: ScriptProcess } | { error: unknown } => {
  try {
    return { child: start() };
  } catch (error) {
    return { error };
  }
};

const collectOutput = (child: ScriptProcess, chunks: Buffer[]) => {
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
};

/** One line per excluded package: an exclusion nobody can see reads as never found. */
export const exclusionNotices = (
  packages: readonly DiscoveredPackage[],
  excluded: Map<string, string>,
): string[] =>
  packages.flatMap((pkg) => {
    const reason = excluded.get(pkg.name);
    return reason === undefined ? [] : [`not run: ${pkg.name} — ${reason}`];
  });

/** One annotation per failed package, naming the script it is blamed on. */
export const failureAnnotations = (outcomes: readonly SuiteOutcome[]): string[] =>
  outcomes
    .filter((outcome) => outcome.outcome === "failed")
    .map(
      (outcome) =>
        `::error::${outcome.name} failed (pnpm run ${outcome.failedScript}). Fix it, or add it to ` +
        `.github/package-suites.excluded with a reason.`,
    );

export const summarise = (outcomes: SuiteOutcome[]): string[] => {
  const count = (kind: SuiteOutcome["outcome"]) =>
    outcomes.filter((o) => o.outcome === kind).length;
  const lines = [
    "### Package suites",
    "",
    "| outcome | count |",
    "| --- | --- |",
    `| passed | ${count("passed")} |`,
    `| failed | ${count("failed")} |`,
    `| excluded (registered, not run) | ${count("skipped")} |`,
  ];
  const failed = outcomes.filter((o) => o.outcome === "failed");
  if (failed.length > 0) {
    lines.push("", `Failed: ${failed.map((o) => o.name).join(" ")}`);
  }
  return lines;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const root = process.cwd();
  const registerPath = join(root, ".github/package-suites.excluded");

  if (!existsSync(registerPath)) {
    console.error(`::error::excluded register is missing: ${registerPath}`);
    process.exit(1);
  }
  const { entries, errors } = parseRegister(
    readFileSync(registerPath, "utf8"),
    ".github/package-suites.excluded",
  );
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);

  let projects: PnpmProject[];
  try {
    projects = JSON.parse(
      execFileSync("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch {
    console.error(
      "::error::pnpm list returned nothing. The workspace could not be enumerated, so this job cannot know what it is meant to run.",
    );
    process.exit(1);
  }

  const discovered = discover(projects, root);
  if (discovered.length === 0) {
    console.error(
      "::error::No workspace package declares a suite script. That is not a state this repository has ever been in, so treat it as a broken discovery step rather than as good news.",
    );
    process.exit(1);
  }

  const stale = staleEntries(
    entries,
    discovered.map((p) => p.name),
  );
  for (const name of stale) {
    console.error(
      `::error::'${name}' is registered but no workspace package by that name declares a test script. Delete the line, or fix the name if the package was renamed.`,
    );
  }
  if (stale.length > 0) process.exit(1);

  const excluded = new Map(entries.map((e) => [e.name, e.reason]));
  let shard: { index: number; total: number };
  try {
    shard = parseShard(process.env.PACKAGE_SUITES_SHARD);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  let only: Set<string> | undefined;
  try {
    only = parseOnly(process.env.PACKAGE_SUITES_ONLY);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  // Narrowed after the stale-register check, which has to see every package.
  const reached = only ? discovered.filter((pkg) => only.has(pkg.name)) : discovered;
  if (only) console.log(`Affected by this change: ${reached.length} of ${discovered.length}.`);
  const weightsPath = join(root, ".github/package-suites.weights");
  const parsedWeights = parseWeights(
    existsSync(weightsPath) ? readFileSync(weightsPath, "utf8") : "",
    ".github/package-suites.weights",
  );
  for (const error of parsedWeights.errors) console.error(error);
  if (parsedWeights.errors.length > 0) process.exit(1);
  const known = new Set(discovered.map((p) => p.name));
  for (const name of parsedWeights.weights.keys()) {
    if (!known.has(name)) {
      console.log(`::warning::'${name}' has a weight but is not a workspace package.`);
    }
  }
  // An excluded package runs nothing, so it adds nothing to a shard's time.
  const weightOf = (pkg: DiscoveredPackage): number =>
    excluded.has(pkg.name) ? 0 : (parsedWeights.weights.get(pkg.name) ?? DEFAULT_WEIGHT_SECONDS);
  let concurrency: number;
  try {
    concurrency = parseConcurrency(process.env.PACKAGE_SUITES_CONCURRENCY);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  // Every shard reads the same concurrency from the job's env, so they agree.
  const split = balanceByWallTime({ items: reached, weightOf, concurrency, total: shard.total });
  const assigned = split.groups[shard.index - 1] ?? [];
  const expected = split.walls[shard.index - 1] ?? 0;
  console.log(
    `Shard ${shard.index}/${shard.total}: ${assigned.length} of ${reached.length} packages, ` +
      `about ${Math.round(expected)}s of suites.`,
  );
  // The nightly flaky-test hunt (.github/workflows/nightly.yml) reruns the suites
  // with vitest's shuffle and seed and a JSON report each; unset, nothing changes.
  const hunt = process.env.PACKAGE_SUITES_VITEST_ARGS;
  const reportDir = process.env.PACKAGE_SUITES_REPORT_DIR;
  const extraArgsFor = (pkg: DiscoveredPackage, script: string): string[] | undefined => {
    if (hunt === undefined || hunt.trim() === "") return [];
    const body = (JSON.parse(readFileSync(join(root, pkg.dir, "package.json"), "utf8")).scripts ??
      {})[script] as string | undefined;
    return vitestArgsFor({
      body: body ?? "",
      extra: hunt.trim().split(/\s+/),
      reportFile: reportDir
        ? join(resolve(reportDir), reportFileName({ pkg: pkg.name, script }))
        : undefined,
    });
  };
  for (const line of exclusionNotices(assigned, excluded)) console.log(line);
  // A suite keeps its own configured worker count unless workerEnvFor gives a
  // heavy unit suite every core; VITEST_MAX_WORKERS outranks the config, so it
  // is never set for an integration suite, whose serial files would overlap.
  const cores = availableParallelism();
  const live = concurrency === 1;
  console.log(`Running up to ${concurrency} suite(s) at once.`);
  const huntCommandFor = (job: SuiteJob): string[] | undefined => {
    const extra = extraArgsFor(job.pkg, job.script) ?? [];
    return extra.length > 0 ? ["--filter", job.pkg.name, "run", job.script, ...extra] : undefined;
  };
  const runner = createSuiteRunner({
    live,
    start: (job) =>
      // The hunt skips nx, whose cache would replay a result instead of rerunning under the seed.
      spawn("pnpm", huntCommandFor(job) ?? commandFor(job), {
        stdio: live ? "inherit" : ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...workerEnvFor({ job, heavy: isHeavyPackage({ weightOf, pkg: job.pkg }), cores }),
        },
      }),
    log: (line) => console.log(line),
    write: (output) => process.stdout.write(output),
  });
  if (!live) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        runner.flushUnfinished();
        // Exits once stdout has drained, so the flushed output is not cut short.
        process.stdout.write("", () => process.exit(1));
      });
    }
  }

  const statuses = await runJobs({
    jobs: jobsFor(heaviestFirst({ packages: assigned, weightOf }), excluded),
    concurrency,
    run: (job) => {
      if (extraArgsFor(job.pkg, job.script) !== undefined) return runner.run(job);
      console.log(
        `not a vitest script, not run in the flaky-test hunt: ${job.pkg.name} ${job.script}`,
      );
      return Promise.resolve(0);
    },
    isHeavy: (pkg) => isHeavyPackage({ weightOf, pkg }),
  });
  const statusOf = (pkg: DiscoveredPackage) => (script: string) =>
    [...statuses].find(([job]) => job.pkg === pkg && job.script === script)?.[1] ?? 1;
  const outcomes = assigned.map((pkg) => outcomeOf(pkg, excluded, statusOf(pkg)));
  for (const line of failureAnnotations(outcomes)) console.log(line);

  const summary = summarise(outcomes);
  for (const line of summary) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const refresh = ["", "Refresh the shard weights with `go run ./cmd/suiteweights`."];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${[...summary, ...refresh].join("\n")}\n`);
  }

  const failed = outcomes.filter((o) => o.outcome === "failed");
  if (failed.length > 0) {
    console.error(`::error::${failed.length} package suite(s) failed and are not registered.`);
    process.exit(1);
  }
  console.log(
    `All ${outcomes.filter((o) => o.outcome === "passed").length} package suites passed.`,
  );
}
