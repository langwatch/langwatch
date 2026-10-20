// Runs every workspace package's own test suite, discovered from pnpm's
// workspace membership rather than from a hand-written list that reached
// seventeen of a hundred and sixty before this replaced it.
// Spec: specs/ci/package-suite-integration-lane.feature, specs/ci/browser-test-lane.feature

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
 * Splits `items` into `total` groups, heaviest first onto the lightest group.
 * Every shard computes this alone, so ties break on name then lowest group:
 * the answers must agree exactly or a package runs twice or not at all.
 */
export const balanceShards = <T extends { name: string }>({
  items,
  weightOf,
  total,
}: {
  items: readonly T[];
  weightOf: (item: T) => number;
  total: number;
}): T[][] => {
  const loads = Array.from({ length: total }, () => 0);
  const groupOf = new Map<string, number>();
  const heaviestFirst = items
    .map((item) => ({ item, weight: weightOf(item) }))
    .toSorted((a, b) => b.weight - a.weight || a.item.name.localeCompare(b.item.name));
  for (const { item, weight } of heaviestFirst) {
    const lightest = loads.indexOf(Math.min(...loads));
    groupOf.set(item.name, lightest);
    loads[lightest] += weight;
  }
  return loads.map((_, group) => items.filter((item) => groupOf.get(item.name) === group));
};

/** This shard's share of `items` under the weighted split. */
export const shardOf = <T extends { name: string }>({
  items,
  weightOf,
  shard,
}: {
  items: readonly T[];
  weightOf: (item: T) => number;
  shard: { index: number; total: number };
}): T[] => balanceShards({ items, weightOf, total: shard.total })[shard.index - 1] ?? [];

/** The slow packages of a run, in the weights file's own format, to paste back. */
export const formatMeasured = (measured: { name: string; seconds: number }[]): string[] =>
  measured
    .filter((entry) => entry.seconds >= 20)
    .toSorted((a, b) => b.seconds - a.seconds || (a.name < b.name ? -1 : 1))
    .map((entry) => `${entry.name}  ${Math.round(entry.seconds)}`);

/**
 * The nightly flaky-test hunt names each package suite's JSON report after the
 * package and script, so the report alone says what to rerun. `:` is not allowed
 * in an artifact path, so a script's colon is written as `~`.
 */
export const reportFileName = ({ pkg, script }: { pkg: string; script: string }): string =>
  `${encodeURIComponent(pkg)}__${script.replaceAll(":", "~")}.json`;

export const parseReportFileName = (name: string): { pkg: string; script: string } | undefined => {
  const match = /^(.+)__([^_]+)\.json$/.exec(name);
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

/** Runs one package's scripts and reports the package's single verdict. */
export const runPackage = (
  pkg: DiscoveredPackage,
  excluded: Map<string, string>,
  run: (name: string, script: string) => number,
  log: (line: string) => void,
): SuiteOutcome => {
  const reason = excluded.get(pkg.name);
  if (reason !== undefined) {
    // Named out loud, never silently: an exclusion nobody can see in the log is
    // indistinguishable from a package discovery never found.
    log(`not run: ${pkg.name} — ${reason}`);
    return { name: pkg.name, outcome: "skipped", reason };
  }

  // Every script runs even after one fails, so a pull request sees all of its
  // failures at once rather than one per push. The first is what it is blamed on.
  let failedScript: string | undefined;
  for (const script of pkg.scripts) {
    log(`::group::${pkg.name} (${pkg.dir}) — pnpm run ${script}`);
    const status = run(pkg.name, script);
    log("::endgroup::");
    if (status !== 0 && failedScript === undefined) failedScript = script;
  }

  if (failedScript === undefined) return { name: pkg.name, outcome: "passed" };
  log(
    `::error::${pkg.name} failed (pnpm run ${failedScript}). Fix it, or add it to ` +
      `.github/package-suites.excluded with a reason.`,
  );
  return { name: pkg.name, outcome: "failed", failedScript };
};

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
  const assigned = shardOf({ items: reached, weightOf, shard });
  const expected = assigned.reduce((sum, pkg) => sum + weightOf(pkg), 0);
  console.log(
    `Shard ${shard.index}/${shard.total}: ${assigned.length} of ${reached.length} packages, ` +
      `about ${Math.round(expected)}s of suites.`,
  );
  // Serial on purpose. Each suite is its own vitest with its own worker pool,
  // so several at once oversubscribe a 4-core runner and turn real results into
  // "[vitest-pool]: Worker forks emitted error" — which looks like a broken
  // test and is not one.
  const measured: { name: string; seconds: number }[] = [];
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
  const outcomes = assigned.map((pkg) => {
    const startedAt = Date.now();
    const outcome = runPackage(
      pkg,
      excluded,
      (name, script) => {
        const extra = extraArgsFor(pkg, script);
        if (extra === undefined) {
          console.log(`not a vitest script, not run in the flaky-test hunt: ${name} ${script}`);
          return 0;
        }
        return (
          spawnSync("pnpm", ["--filter", name, "run", script, ...extra], { stdio: "inherit" })
            .status ?? 1
        );
      },
      (line) => console.log(line),
    );
    if (outcome.outcome === "passed") {
      measured.push({ name: pkg.name, seconds: (Date.now() - startedAt) / 1000 });
    }
    return outcome;
  });

  const summary = summarise(outcomes);
  for (const line of summary) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const times = formatMeasured(measured);
    const refresh =
      times.length === 0
        ? []
        : [
            "",
            "<details><summary>Measured seconds (weights file format)</summary>",
            "",
            "```",
            ...times,
            "```",
            "</details>",
          ];
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
