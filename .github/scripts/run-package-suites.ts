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
  // Serial on purpose. Each suite is its own vitest with its own worker pool,
  // so several at once oversubscribe a 4-core runner and turn real results into
  // "[vitest-pool]: Worker forks emitted error" — which looks like a broken
  // test and is not one.
  const outcomes = discovered.map((pkg) =>
    runPackage(
      pkg,
      excluded,
      (name, script) =>
        spawnSync("pnpm", ["--filter", name, "run", script], { stdio: "inherit" }).status ?? 1,
      (line) => console.log(line),
    ),
  );

  const summary = summarise(outcomes);
  for (const line of summary) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
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
