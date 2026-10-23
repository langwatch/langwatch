// The nightly hygiene and lint report: every finding still standing, counted per rule with
// its heaviest files and compared with last night's. Red only on something new; why and
// what counts as new: dev/docs/nightly-suite.md. Spec: specs/ci/nightly-suite.feature.
//   node --experimental-strip-types .github/scripts/nightly-hygiene.ts --dir <inputs> \
//     --previous previous/hygiene.json --out hygiene.json --markdown hygiene.md

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TOP_FILES = 10;

export interface Finding {
  rule: string;
  file: string;
}

export interface ToolResult {
  /** False when the tool produced no report to count: a crash, never zero findings. */
  reported: boolean;
  findings: Finding[];
}

export interface Category {
  tool: string;
  rule: string;
  count: number;
  files: [string, number][];
}

export interface HygieneReport {
  date: string;
  commit: string;
  tools: Record<string, { reported: boolean }>;
  categories: Record<string, Category>;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const lines = (text: string): string[] => text.replace(ANSI, "").split("\n");

/** `eslint(no-nested-ternary)` reads as `eslint/no-nested-ternary`. */
const ruleName = (code: string): string => code.replace(/^([\w-]+)\((.+)\)$/, "$1/$2");

/**
 * `pnpm lint` output: `file:line:col: message [code]` lines and `N problem(s)` last; no code
 * is an unused directive. The count prints even after a crash, so a process's own
 * `oxlint -c <config> exited` line (stderr, captured) is what marks one.
 */
export const parseOxlint = ({ text }: { text: string }): ToolResult => {
  const findings: Finding[] = [];
  let summarised = false;
  let crashed = false;
  for (const line of lines(text)) {
    if (/^\d+ problem\(s\)$/.test(line.trim())) summarised = true;
    if (/^oxlint -c \S+ exited /.test(line)) crashed = true;
    const match = /^([^\s:][^:]*):\d+:\d+: (.*)$/.exec(line);
    if (!match) continue;
    const code = /\s\[([^\]\s]+)\]$/.exec(match[2])?.[1];
    findings.push({ file: match[1], rule: code ? ruleName(code) : "unused-directive" });
  }
  return { reported: summarised && !crashed, findings };
};

/**
 * `error TS2322` lines from the typecheck, in either of the compiler's formats:
 * `file(line,col): error TS…` or `file:line:col - error TS…`. A failed run with
 * no error line is a typecheck that did not finish, not a clean one.
 */
export const parseTypecheck = ({
  text,
  exitCode,
}: {
  text: string;
  exitCode: number;
}): ToolResult => {
  const findings: Finding[] = [];
  // Nx prints `> nx run <project>:typecheck` before a project's output, whose
  // paths are relative to that project, so the project is named with the file.
  let project = "";
  for (const line of lines(text)) {
    project = /^> nx run ([^\s:]+):/.exec(line)?.[1] ?? project;
    const match =
      /(?:^|\s)([^\s():]+\.[cm]?[jt]sx?)(?:\(\d+,\d+\)|:\d+:\d+)(?::| -) error (TS\d+)/.exec(line);
    if (match)
      findings.push({ file: project ? `${project} ${match[1]}` : match[1], rule: match[2] });
  }
  return { reported: exitCode === 0 || findings.length > 0, findings };
};

/**
 * The enforcer's text summary: `architecture-enforcer: N findings …` then `   12  policy` lines,
 * or its clean-run line (cli.ts). Its crash and usage messages share the prefix and are no report.
 */
export const parseArchitecture = ({ text }: { text: string }): ToolResult => {
  const all = lines(text);
  if (all.includes("architecture-enforcer: package boundaries are sealed"))
    return { reported: true, findings: [] };
  const header = all.findIndex((line) => /^architecture-enforcer: \d+ findings?\b/.test(line));
  if (header === -1) return { reported: false, findings: [] };
  const findings: Finding[] = [];
  for (const line of all.slice(header + 1)) {
    const match = /^ +(\d+) {2}(\S+)$/.exec(line);
    if (!match) break;
    // The enforcer reports counts per policy, not files.
    for (let index = 0; index < Number(match[1]); index++)
      findings.push({ rule: match[2], file: "(not reported per file)" });
  }
  return { reported: true, findings };
};

/** golangci-lint's JSON output: one issue per finding, named by the linter that raised it. */
export const parseGolangci = ({ text }: { text: string }): ToolResult => {
  try {
    const parsed = JSON.parse(text) as {
      Issues?: { FromLinter?: string; Pos?: { Filename?: string } }[] | null;
    };
    return {
      reported: true,
      findings: (parsed.Issues ?? []).map((issue) => ({
        rule: issue.FromLinter ?? "unknown",
        file: issue.Pos?.Filename ?? "?",
      })),
    };
  } catch {
    return { reported: false, findings: [] };
  }
};

/** The blocking checks the pull request lint job runs, one finding each when it fails. */
export const parseChecks = ({ text }: { text: string }): ToolResult => {
  const findings: Finding[] = [];
  const rows = lines(text).filter((line) => line.includes("\t"));
  for (const row of rows) {
    const [name, exit] = row.split("\t");
    findings.push(...(Number(exit) === 0 ? [] : [{ rule: name, file: "(the whole check)" }]));
  }
  return { reported: rows.length > 0, findings };
};

/** Findings per tool, counted per rule with the files that carry the most. */
export const buildReport = ({
  date,
  commit,
  results,
  checks,
}: {
  date: string;
  commit: string;
  results: Record<string, ToolResult>;
  /** Every check that ran, so a passing one still has a zero to compare with tomorrow. */
  checks?: string[];
}): HygieneReport => {
  const categories: Record<string, Category> = {};
  for (const name of checks ?? [])
    categories[`check/${name}`] = { tool: "check", rule: name, count: 0, files: [] };
  for (const [tool, result] of Object.entries(results)) {
    const byRule = new Map<string, Map<string, number>>();
    for (const finding of result.findings) {
      const files = byRule.get(finding.rule) ?? new Map<string, number>();
      files.set(finding.file, (files.get(finding.file) ?? 0) + 1);
      byRule.set(finding.rule, files);
    }
    for (const [rule, files] of byRule) {
      const count = [...files.values()].reduce((sum, value) => sum + value, 0);
      const top = [...files]
        .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_FILES);
      categories[`${tool}/${rule}`] = { tool, rule, count, files: top };
    }
  }
  const tools = Object.fromEntries(
    Object.entries(results).map(([tool, result]) => [tool, { reported: result.reported }]),
  );
  return { date, commit, tools, categories };
};

export interface Row {
  key: string;
  now: number;
  before: number | null;
}

export interface Regression {
  key: string;
  reason: string;
}

/**
 * Tonight against last night. With no previous report tonight is the baseline
 * and nothing is new, except a tool that produced no report. A tool that did not
 * report last night has no baseline either, so its rules are not "new".
 */
export const compareReports = ({
  previous,
  current,
}: {
  previous: HygieneReport | null;
  current: HygieneReport;
}): { rows: Row[]; regressions: Regression[] } => {
  const regressions: Regression[] = [];
  for (const [tool, { reported }] of Object.entries(current.tools)) {
    const reportedBefore = previous?.tools[tool]?.reported ?? true;
    if (!reported && reportedBefore)
      regressions.push({ key: tool, reason: "produced no report, so its findings are unknown" });
  }
  const keys = new Set([
    ...Object.keys(current.categories),
    ...Object.keys(previous?.categories ?? {}),
  ]);
  const rows = [...keys]
    .map((key) => rowOf({ key, previous, current }))
    .filter((row) => row.now > 0 || (row.before ?? 0) > 0)
    .toSorted((a, b) => a.key.split("/")[0].localeCompare(b.key.split("/")[0]) || b.now - a.now);
  for (const row of rows) {
    const regression = regressionOf({ row, current });
    if (regression) regressions.push(regression);
  }
  return { rows, regressions };
};

const toolOf = ({ key, previous, current }: { key: string } & Reports): string =>
  current.categories[key]?.tool ?? previous?.categories[key]?.tool ?? "";

type Reports = { previous: HygieneReport | null; current: HygieneReport };

/** One rule tonight and last night; last night is null when it has no baseline. */
function rowOf({ key, previous, current }: { key: string } & Reports): Row & { tool: string } {
  const tool = toolOf({ key, previous, current });
  const comparable = previous !== null && previous.tools[tool]?.reported !== false;
  const before = comparable ? (previous.categories[key]?.count ?? 0) : null;
  return { key, tool, now: current.categories[key]?.count ?? 0, before };
}

/** Why a rule is new tonight, if it is. A tool that did not report tonight has no counts. */
function regressionOf({
  row,
  current,
}: {
  row: Row & { tool: string };
  current: HygieneReport;
}): Regression | undefined {
  const unknownTonight = current.tools[row.tool]?.reported === false;
  if (row.before === null || unknownTonight) return undefined;
  if (row.before === 0 && row.now > 0)
    return { key: row.key, reason: `is new tonight with ${row.now}` };
  if (row.now > row.before)
    return { key: row.key, reason: `rose from ${row.before} to ${row.now}` };
  return undefined;
}

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** The report's section of the nightly dashboard and the job summary. */
export const renderHygiene = ({
  current,
  rows,
  regressions,
  baseline,
}: {
  current: HygieneReport;
  rows: Row[];
  regressions: Regression[];
  baseline: boolean;
}): string => {
  const total = rows.reduce((sum, row) => sum + row.now, 0);
  const rose = rows.filter((row) => row.before !== null && row.now > row.before).length;
  const fell = rows.filter((row) => row.before !== null && row.now < row.before).length;
  const out = [
    "## Hygiene and lint",
    "",
    `${total} findings standing under ${rows.filter((row) => row.now > 0).length} rules on commit \`${current.commit.slice(0, 10)}\`; ${rose} rules rose and ${fell} fell since last night.`,
    "",
  ];
  if (baseline) out.push("No report from last night to compare with: tonight is the baseline.", "");
  const silent = Object.entries(current.tools).filter(([, tool]) => !tool.reported);
  for (const [tool] of silent)
    out.push(`**${tool} produced no report**: its findings are unknown tonight.`, "");
  if (regressions.length > 0) {
    out.push(`### ${regressions.length} new since last night`, "");
    for (const regression of regressions) out.push(`- \`${regression.key}\` ${regression.reason}`);
    out.push("");
  }
  out.push(
    "| rule | findings | change vs last night | most findings in |",
    "| --- | ---: | ---: | --- |",
  );
  for (const row of rows) {
    const files = (current.categories[row.key]?.files ?? [])
      .slice(0, 3)
      .map(([file, count]) => `\`${file}\` (${count})`)
      .join(", ");
    const change = row.before === null ? "n/a" : signed(row.now - row.before);
    out.push(`| ${row.key} | ${row.now} | ${change} | ${files} |`);
  }
  out.push("");
  return out.join("\n");
};

const option = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const args = process.argv.slice(2);
  const dir = option(args, "dir") ?? ".";
  const read = (name: string): string =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
  const exitOf = (name: string): number =>
    read(name).trim() === "" ? 1 : Number(read(name).trim());
  const checksText = read("checks.tsv");
  const current = buildReport({
    date: new Date().toISOString().slice(0, 10),
    commit: process.env.GITHUB_SHA ?? "unknown",
    results: {
      typecheck: parseTypecheck({
        text: read("typecheck.log"),
        exitCode: exitOf("typecheck-exit.txt"),
      }),
      oxlint: parseOxlint({ text: read("lint.txt") }),
      "oxlint-types": parseOxlint({ text: read("lint-types.txt") }),
      architecture: parseArchitecture({ text: read("architecture.txt") }),
      golangci: parseGolangci({ text: read("golangci.json") }),
      check: parseChecks({ text: checksText }),
    },
    checks: checksText
      .split("\n")
      .filter((line) => line.includes("\t"))
      .map((line) => line.split("\t")[0]),
  });
  const previousPath = option(args, "previous");
  const previous =
    previousPath && existsSync(previousPath)
      ? (JSON.parse(readFileSync(previousPath, "utf8")) as HygieneReport)
      : null;
  const { rows, regressions } = compareReports({ previous, current });
  const markdown = renderHygiene({ current, rows, regressions, baseline: previous === null });
  writeFileSync(option(args, "out") ?? "hygiene.json", `${JSON.stringify(current, null, 2)}\n`);
  writeFileSync(option(args, "markdown") ?? "hygiene.md", markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  for (const regression of regressions)
    console.log(`::error::${regression.key} ${regression.reason}`);
  process.exit(regressions.length > 0 ? 1 : 0);
}
