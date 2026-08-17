// Guards the two rules that make a native `on.paths` filter safe.
//
// Background. Most CI workflows here run unconditionally and decide internally
// whether to do real work, then report through an `alls-green` aggregator named
// `<name>-complete`. That shape exists so branch protection always has a check
// to require: a workflow GitHub filters out never reports at all, and a
// REQUIRED check that never reports leaves the pull request waiting forever.
//
// The cost is that deciding "nothing to do" still leases a runner — a gate job
// spends five to eight seconds doing it. Workflows with no required check can
// skip that entirely by filtering in `on:`, which GitHub evaluates before it
// allocates anything. Two things go silently wrong when they do:
//
//   R1  A workflow keeps a `changes` gate for per-job filters AND adds
//       `on.pull_request.paths`. If the `on.paths` list is not a superset of
//       every path the gate filters on, the workflow never starts for those
//       paths, so the job that filter guards never runs — and the pull request
//       goes green having tested nothing.
//
//   R2  A workflow has both `on.pull_request.paths` and a `*-complete`
//       aggregator. Those two are contradictory: the aggregator exists to give
//       branch protection a stable check, and the filter is what stops it
//       reporting. Whichever was intended, the pair is a bug.
//
// Deliberately dependency-free and line-based, matching guard-pull-request-
// target.ts: these run on a bare runner with `node --experimental-strip-types`
// and no install step.
//
// Spec: specs/ci/path-filters.feature

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface WorkflowIssue {
  file: string;
  rule: "R1" | "R2";
  detail: string;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Lines of the block introduced by `key` at `indent`, excluding the key line. */
export const blockUnder = (
  lines: string[],
  startIndex: number,
  indent: number,
): string[] => {
  const out: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trim().startsWith("#")) {
      out.push(line);
      continue;
    }
    if (indentOf(line) <= indent) break;
    out.push(line);
  }
  return out;
};

const findKey = (
  lines: string[],
  key: string,
  indent: number,
): number => lines.findIndex((l) => indentOf(l) === indent && l.trim() === `${key}:`);

/** Every `- value` entry in a block, unquoted, comments dropped. */
export const listEntries = (lines: string[]): string[] => {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const raw = trimmed.slice(2).trim();
    if (raw.startsWith("#")) continue;
    out.push(raw.replace(/^['"]/, "").replace(/['"]$/, ""));
  }
  return out;
};

/** `on.pull_request.paths`, or null when the workflow declares none. */
export const pullRequestPaths = (source: string): string[] | null => {
  const lines = source.split("\n");
  const onIndex = findKey(lines, "on", 0);
  if (onIndex === -1) return null;
  const onBlock = blockUnder(lines, onIndex, 0);
  const prIndex = findKey(onBlock, "pull_request", 2);
  if (prIndex === -1) return null;
  const prBlock = blockUnder(onBlock, prIndex, 2);
  const pathsIndex = findKey(prBlock, "paths", 4);
  if (pathsIndex === -1) return null;
  return listEntries(blockUnder(prBlock, pathsIndex, 4));
};

/** Every path named inside any `filters:` literal block in the file. */
export const gateFilterPaths = (source: string): string[] => {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*filters:\s*\|/.test(lines[i]!)) continue;
    out.push(...listEntries(blockUnder(lines, i, indentOf(lines[i]!))));
  }
  return out;
};

/** Job names at the two-space level that end in `-complete`. */
export const aggregatorJobs = (source: string): string[] => {
  const lines = source.split("\n");
  const jobsIndex = findKey(lines, "jobs", 0);
  if (jobsIndex === -1) return [];
  return blockUnder(lines, jobsIndex, 0)
    .filter((l) => indentOf(l) === 2 && /^[a-z0-9_-]+:\s*$/i.test(l.trim()))
    .map((l) => l.trim().slice(0, -1))
    .filter((name) => name.endsWith("-complete"));
};

/** Does an `on.paths` pattern cover a path a gate filter names? */
export const covers = (pattern: string, target: string): boolean => {
  if (pattern === target) return true;
  if (pattern.endsWith("/**")) return target.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("**")) return target.startsWith(pattern.slice(0, -2));
  return false;
};

export const inspect = (file: string, source: string): WorkflowIssue[] => {
  const paths = pullRequestPaths(source);
  if (paths === null) return [];

  const issues: WorkflowIssue[] = [];

  for (const aggregator of aggregatorJobs(source)) {
    issues.push({
      file,
      rule: "R2",
      detail:
        `declares on.pull_request.paths AND the aggregator job "${aggregator}". ` +
        `An aggregator exists so a required check always reports; a path filter ` +
        `is what stops it reporting. Drop one.`,
    });
  }

  for (const declared of new Set(gateFilterPaths(source))) {
    if (paths.some((pattern) => covers(pattern, declared))) continue;
    issues.push({
      file,
      rule: "R1",
      detail:
        `gate filter names "${declared}", which no on.pull_request.paths entry ` +
        `covers. A change to it would never start this workflow, so the job that ` +
        `filter guards would silently not run.`,
    });
  }

  return issues;
};

export const main = (dir = ".github/workflows"): number => {
  const issues: WorkflowIssue[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    issues.push(...inspect(name, readFileSync(join(dir, name), "utf8")));
  }

  if (issues.length > 0) {
    console.error("Path-filter guard failed:");
    for (const issue of issues) {
      console.error(`- [${issue.rule}] ${issue.file}: ${issue.detail}`);
    }
    return 1;
  }

  console.log("path-filter guard passed");
  return 0;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  // The workflows directory is an argument so CI can point a trusted copy of
  // this script at the pull request's checkout, the way the pull_request_target
  // guard does — a pull request must not be able to disable its own guard by
  // editing the script in the same commit.
  process.exitCode = main(process.argv[2] ?? ".github/workflows");
}
