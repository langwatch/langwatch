// The flaky-test hunt's verdict from every shuffled run's JSON report, read from
// <dir>/seed-<seed>/<file named by run-package-suites.ts>. Flaky against failing, and why
// only a newly flaky test is red: dev/docs/nightly-suite.md. Spec: specs/ci/nightly-suite.feature
//   node --experimental-strip-types .github/scripts/nightly-flaky.ts --dir results \
//     --root "$GITHUB_WORKSPACE" --previous previous/flaky.json

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseReportFileName } from "./run-package-suites.ts";

/** What one file failing to load is recorded as, in place of the tests it never ran. */
export const FILE_DID_NOT_RUN = "(the file failed before its tests ran)";

export interface VitestReport {
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: { fullName: string; status: string }[];
  }[];
}

export interface SuiteRun {
  seed: string;
  pkg: string;
  script: string;
  report: VitestReport;
}

export interface TestOutcomes {
  pkg: string;
  script: string;
  file: string;
  test: string;
  failedSeeds: string[];
  passedSeeds: string[];
}

export interface FlakyReport {
  date: string;
  commit: string;
  seeds: string[];
  flaky: TestOutcomes[];
  failing: TestOutcomes[];
  /** Suites that wrote no report in some runs: crashed, timed out, or never started. */
  missing: { pkg: string; script: string; seeds: string[] }[];
}

const keyOf = (outcome: Pick<TestOutcomes, "pkg" | "script" | "file" | "test">): string =>
  [outcome.pkg, outcome.script, outcome.file, outcome.test].join("\t");

const relativeTo = (root: string, path: string): string =>
  root !== "" && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

interface Observation {
  test: Omit<TestOutcomes, "failedSeeds" | "passedSeeds">;
  seed: string;
  passed: boolean;
}

/**
 * What one run says about each test, skipped and todo tests left out. A file that
 * loaded counts as a pass of the file and one that failed to load as its failure,
 * so a file that failed to load in only some runs is flaky as a file.
 */
function observationsOf({ run, root }: { run: SuiteRun; root: string }): Observation[] {
  return (run.report.testResults ?? []).flatMap((result) => {
    const base = { pkg: run.pkg, script: run.script, file: relativeTo(root, result.name) };
    const assertions = result.assertionResults ?? [];
    const didNotLoad = assertions.length === 0 && result.status === "failed";
    const file = { test: { ...base, test: FILE_DID_NOT_RUN }, seed: run.seed, passed: !didNotLoad };
    const tests = assertions
      .filter((assertion) => assertion.status === "passed" || assertion.status === "failed")
      .map((assertion) => ({
        test: { ...base, test: assertion.fullName },
        seed: run.seed,
        passed: assertion.status === "passed",
      }));
    return [file, ...tests];
  });
}

/** Each test's pass and fail seeds across the runs; a file's own entry if it failed to load. */
export const collectOutcomes = ({
  runs,
  root,
}: {
  runs: SuiteRun[];
  root: string;
}): TestOutcomes[] => {
  const byKey = new Map<string, TestOutcomes>();
  for (const { test, seed, passed } of runs.flatMap((run) => observationsOf({ run, root }))) {
    const entry = byKey.get(keyOf(test)) ?? { ...test, failedSeeds: [], passedSeeds: [] };
    (passed ? entry.passedSeeds : entry.failedSeeds).push(seed);
    byKey.set(keyOf(test), entry);
  }
  return [...byKey.values()].filter(
    (entry) => entry.test !== FILE_DID_NOT_RUN || entry.failedSeeds.length > 0,
  );
};

/** Flaky: failed in some runs and passed in others. Failing: failed in every run it ran in. */
export const classify = ({
  outcomes,
}: {
  outcomes: TestOutcomes[];
}): { flaky: TestOutcomes[]; failing: TestOutcomes[] } => {
  const sorted = outcomes.toSorted((a, b) => keyOf(a).localeCompare(keyOf(b)));
  return {
    flaky: sorted.filter((item) => item.failedSeeds.length > 0 && item.passedSeeds.length > 0),
    failing: sorted.filter((item) => item.failedSeeds.length > 0 && item.passedSeeds.length === 0),
  };
};

/** Suites with a report in some runs and not others, with the seeds they are missing from. */
export const missingSuites = ({
  runs,
  seeds,
}: {
  runs: SuiteRun[];
  seeds: string[];
}): FlakyReport["missing"] => {
  const seen = new Map<string, Set<string>>();
  for (const run of runs) {
    const key = `${run.pkg}\t${run.script}`;
    seen.set(key, (seen.get(key) ?? new Set()).add(run.seed));
  }
  return [...seen]
    .filter(([, present]) => present.size < seeds.length)
    .map(([key, present]) => {
      const [pkg, script] = key.split("\t");
      return { pkg, script, seeds: seeds.filter((seed) => !present.has(seed)) };
    })
    .toSorted((a, b) => a.pkg.localeCompare(b.pkg));
};

/** Flaky tests tonight that last night's report did not list; with no report, none are new. */
export const newlyFlaky = ({
  previous,
  current,
}: {
  previous: FlakyReport | null;
  current: FlakyReport;
}): TestOutcomes[] => {
  if (previous === null) return [];
  const known = new Set(previous.flaky.map(keyOf));
  return current.flaky.filter((item) => !known.has(keyOf(item)));
};

/** The command that reruns the package's suite in the order a failing seed gave it. */
export const reproduce = ({
  pkg,
  script,
  seed,
}: {
  pkg: string;
  script: string;
  seed: string;
}): string => `pnpm --filter ${pkg} run ${script} --sequence.shuffle --sequence.seed=${seed}`;

const testLine = (item: TestOutcomes): string =>
  `- \`${item.file}\` ${item.test}: failed with seed ${item.failedSeeds.join(", ")}, passed with ${item.passedSeeds.join(", ") || "none"}. Rerun: \`${reproduce({ pkg: item.pkg, script: item.script, seed: item.failedSeeds[0] })}\``;

/** The hunt's section of the nightly dashboard and the job summary. */
export const renderFlaky = ({
  report,
  fresh,
  baseline,
}: {
  report: FlakyReport;
  fresh: TestOutcomes[];
  baseline: boolean;
}): string => {
  const out = [
    "## Flaky-test hunt",
    "",
    `Every package suite ran ${report.seeds.length} times in shuffled order, seeds ${report.seeds.join(", ")}, on commit \`${report.commit.slice(0, 10)}\`.`,
    `${report.flaky.length} flaky tests, ${fresh.length} of them new since last night; ${report.failing.length} tests failed in every run.`,
    "",
  ];
  if (baseline) out.push("No report from last night to compare with: tonight is the baseline.", "");
  out.push("### Flaky: failed in some runs and passed in others", "");
  if (report.flaky.length === 0) out.push("None.");
  const freshKeys = new Set(fresh.map(keyOf));
  for (const item of report.flaky)
    out.push(`${testLine(item)}${freshKeys.has(keyOf(item)) ? " **New.**" : ""}`);
  out.push("", "### Failed in every run", "");
  if (report.failing.length === 0) out.push("None.");
  for (const item of report.failing.slice(0, 50))
    out.push(`- \`${item.file}\` ${item.test} (${item.pkg} ${item.script})`);
  if (report.failing.length > 50)
    out.push(`- and ${report.failing.length - 50} more, in flaky.json`);
  if (report.missing.length > 0) {
    out.push("", "### Suites with no report in some runs", "");
    for (const suite of report.missing)
      out.push(`- ${suite.pkg} ${suite.script}: no report with seed ${suite.seeds.join(", ")}`);
  }
  out.push("");
  return out.join("\n");
};

/** Every report under <dir>/seed-<seed>/, as written by run-package-suites.ts. */
export const readRuns = ({ dir }: { dir: string }): { runs: SuiteRun[]; seeds: string[] } => {
  const runs: SuiteRun[] = [];
  const seeds: string[] = [];
  if (!existsSync(dir)) return { runs, seeds };
  for (const entry of readdirSync(dir).toSorted()) {
    const seed = /^seed-(\d+)$/.exec(entry)?.[1];
    if (seed === undefined) continue;
    seeds.push(seed);
    for (const name of readdirSync(join(dir, entry))) {
      const named = parseReportFileName(name);
      if (!named) continue;
      try {
        const report = JSON.parse(readFileSync(join(dir, entry, name), "utf8")) as VitestReport;
        runs.push({ seed, ...named, report });
      } catch {
        // A truncated report is a suite that did not finish; missingSuites names it.
      }
    }
  }
  return { runs, seeds };
};

const option = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const args = process.argv.slice(2);
  const { runs, seeds } = readRuns({ dir: option(args, "dir") ?? "results" });
  const { flaky, failing } = classify({
    outcomes: collectOutcomes({ runs, root: option(args, "root") ?? process.cwd() }),
  });
  const report: FlakyReport = {
    date: new Date().toISOString().slice(0, 10),
    commit: process.env.GITHUB_SHA ?? "unknown",
    seeds,
    flaky,
    failing,
    missing: missingSuites({ runs, seeds }),
  };
  const previousPath = option(args, "previous");
  const previous =
    previousPath && existsSync(previousPath)
      ? (JSON.parse(readFileSync(previousPath, "utf8")) as FlakyReport)
      : null;
  const fresh = newlyFlaky({ previous, current: report });
  const markdown = renderFlaky({ report, fresh, baseline: previous === null });
  writeFileSync(option(args, "out") ?? "flaky.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(option(args, "markdown") ?? "flaky.md", markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (runs.length === 0) {
    console.log("::error::No suite wrote a report, so the hunt saw nothing.");
    process.exit(1);
  }
  for (const item of fresh) console.log(`::error::newly flaky: ${item.file} ${item.test}`);
  process.exit(fresh.length > 0 ? 1 : 0);
}
