#!/usr/bin/env node
// Nightly codebase health: type-check cost, reference-chain depth, emitted .d.ts
// size and architecture findings in one health.json, compared with last night's.
// A jump opens or comments on the issue labelled `codebase-health`.
// Workflow: .github/workflows/codebase-health.yml. Spec: specs/tooling/codebase-health.feature.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROGRAM_GROWTH_RATIO = 0.25;
export const PROGRAM_GROWTH_FLOOR = 100_000;
export const TOTAL_INSTANTIATIONS_RATIO = 0.1;
export const CHAIN_DEPTH_STEP = 1;
export const DECLARATION_SIZE_RATIO = 0.1;
export const LARGE_DECLARATION_BYTES = 200 * 1024;
export const ISSUE_LABEL = "codebase-health";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".worktrees", ".claude", ".nx"]);

const readConfig = (file) =>
  JSON.parse(
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
function configOf(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat?.isDirectory() ? join(path, "tsconfig.json") : path;
}

/** Configs on the longest reference path below the root solution, the root not counted. */
export function longestReferenceChain({ root }) {
  const depth = new Map();
  const visiting = new Set();
  const walk = (file) => {
    if (depth.has(file)) return depth.get(file);
    if (visiting.has(file) || !existsSync(file)) return { length: 0, path: [] };
    visiting.add(file);
    let best = { length: 0, path: [] };
    for (const reference of readConfig(file).references ?? []) {
      const below = walk(configOf(resolve(dirname(file), reference.path)));
      if (below.length > best.length) best = below;
    }
    visiting.delete(file);
    const result = { length: best.length + 1, path: [relative(root, file), ...best.path] };
    depth.set(file, result);
    return result;
  };
  const top = walk(join(root, "tsconfig.json"));
  return { depth: Math.max(top.length - 1, 0), path: top.path.slice(1) };
}

/** Every emitted `.d.ts` under a `dist` directory, node_modules and worktrees skipped. */
export function declarationFiles({ root }) {
  const found = [];
  const walk = (directory, insideDist) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, insideDist || entry.name === "dist");
      else if (insideDist && /\.d\.[mc]?ts$/.test(entry.name))
        found.push({ file: relative(root, path), bytes: statSync(path).size });
    }
  };
  walk(root, false);
  return found;
}

/** Findings per policy id from the enforcer's text summary (it has no JSON mode). */
export function parseArchitectureReport({ text }) {
  const counts = {};
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.startsWith("architecture-enforcer: "));
  if (header === -1) return counts;
  for (const line of lines.slice(header + 1)) {
    const match = /^ +(\d+) {2}(\S+)$/.exec(line);
    if (!match) break;
    counts[match[2]] = Number(match[1]);
  }
  return counts;
}

/** Wall time in seconds and peak RSS in KB from GNU `time -v` output. */
export function parseTimeReport({ text }) {
  const wall = /Elapsed \(wall clock\) time \([^)]*\): *([\d:.]+)/.exec(text)?.[1];
  const rss = /Maximum resident set size \(kbytes\): *(\d+)/.exec(text)?.[1];
  const seconds = wall
    ? wall.split(":").reduce((total, part) => total * 60 + Number(part), 0)
    : null;
  return { wallSeconds: seconds, peakRssKb: rss ? Number(rss) : null };
}

/** One health document from the measured parts. */
export function buildHealth({
  date,
  commit,
  programs,
  chain,
  declarations,
  architecture,
  typecheck,
}) {
  const sorted = programs.toSorted((a, b) => b.instantiations - a.instantiations);
  const bySize = declarations.toSorted((a, b) => b.bytes - a.bytes);
  return {
    date,
    commit,
    instantiations: {
      total: programs.reduce((sum, program) => sum + (program.instantiations ?? 0), 0),
      programs: sorted.map(
        ({ config, instantiations, types, checkTime, memoryUsed, hotFiles, hotGenerics }) => ({
          config,
          instantiations,
          types,
          checkTime,
          memoryUsed,
          hotFiles: (hotFiles ?? []).slice(0, 3),
          hotGenerics: (hotGenerics ?? []).slice(0, 3),
        }),
      ),
    },
    chain,
    declarations: {
      totalBytes: declarations.reduce((sum, file) => sum + file.bytes, 0),
      files: declarations.length,
      largest: bySize.slice(0, 10),
      overLimit: bySize.filter((file) => file.bytes > LARGE_DECLARATION_BYTES),
    },
    architecture,
    typecheck,
  };
}

function ratio(previous, now) {
  if (previous > 0) return (now - previous) / previous;
  return now > 0 ? Infinity : 0;
}

function programBreaches({ previous, current }) {
  const before = new Map(
    previous.instantiations.programs.map((program) => [program.config, program]),
  );
  const breaches = [];
  for (const program of current.instantiations.programs) {
    const old = before.get(program.config);
    if (!old) continue;
    const growth = program.instantiations - old.instantiations;
    const grew = ratio(old.instantiations, program.instantiations) > PROGRAM_GROWTH_RATIO;
    if (growth <= PROGRAM_GROWTH_FLOOR || !grew) continue;
    breaches.push({
      metric: `instantiations ${program.config}`,
      previous: old.instantiations,
      now: program.instantiations,
      offenders: [...program.hotFiles, ...program.hotGenerics].map(
        ([name, ms]) => `${name} (${ms} ms)`,
      ),
    });
  }
  return breaches;
}

function architectureBreaches({ previous, current }) {
  return Object.entries(current.architecture)
    .map(([policy, now]) => ({
      metric: `architecture ${policy}`,
      previous: previous.architecture[policy] ?? 0,
      now,
    }))
    .filter((row) => row.now > row.previous);
}

function declarationBreaches({ previous, current }) {
  const breaches = [];
  const size = { previous: previous.declarations.totalBytes, now: current.declarations.totalBytes };
  if (ratio(size.previous, size.now) > DECLARATION_SIZE_RATIO)
    breaches.push({
      metric: ".d.ts total bytes",
      ...size,
      offenders: current.declarations.largest.map(({ file, bytes }) => `${file} (${bytes})`),
    });
  const knownLarge = new Set(previous.declarations.overLimit.map((file) => file.file));
  for (const file of current.declarations.overLimit.filter((item) => !knownLarge.has(item.file)))
    breaches.push({ metric: `.d.ts over 200 KB ${file.file}`, previous: 0, now: file.bytes });
  return breaches;
}

/** The rows that crossed a threshold; empty when there is no previous run. */
export function compareHealth({ previous, current }) {
  if (!previous) return [];
  const breaches = programBreaches({ previous, current });
  const total = { previous: previous.instantiations.total, now: current.instantiations.total };
  if (ratio(total.previous, total.now) > TOTAL_INSTANTIATIONS_RATIO)
    breaches.push({ metric: "instantiations total", ...total });
  if (current.chain.depth - previous.chain.depth >= CHAIN_DEPTH_STEP)
    breaches.push({
      metric: "reference chain depth",
      previous: previous.chain.depth,
      now: current.chain.depth,
      offenders: current.chain.path,
    });
  return [
    ...breaches,
    ...architectureBreaches({ previous, current }),
    ...declarationBreaches({ previous, current }),
  ];
}

const percent = (previous, now) =>
  previous > 0 ? `${(((now - previous) / previous) * 100).toFixed(1)}%` : "new";
const cell = (value) => (value === null || value === undefined ? "n/a" : String(value));

/** The markdown the job summary and the issue share. */
export function renderMarkdown({ previous, current, breaches }) {
  const lines = [`## Codebase health ${current.date} (${current.commit.slice(0, 10)})`, ""];
  if (!previous)
    lines.push("No previous run to compare with; tonight's numbers are the baseline.", "");
  const rows = [
    ["instantiations total", previous?.instantiations.total, current.instantiations.total],
    ["reference chain depth", previous?.chain.depth, current.chain.depth],
    [".d.ts total bytes", previous?.declarations.totalBytes, current.declarations.totalBytes],
    ["typecheck wall seconds", previous?.typecheck.wallSeconds, current.typecheck.wallSeconds],
    ["typecheck peak RSS KB", previous?.typecheck.peakRssKb, current.typecheck.peakRssKb],
    ...Object.entries(current.architecture).map(([policy, now]) => [
      `architecture ${policy}`,
      previous?.architecture[policy] ?? (previous ? 0 : null),
      now,
    ]),
  ];
  lines.push("| metric | previous | now | change |", "| --- | ---: | ---: | ---: |");
  for (const [metric, old, now] of rows)
    lines.push(
      `| ${metric} | ${cell(old)} | ${cell(now)} | ${old == null || now == null ? "" : percent(old, now)} |`,
    );
  lines.push(
    "",
    breaches.length === 0 ? "No regressions." : `### ${breaches.length} regression(s)`,
    "",
  );
  if (breaches.length > 0) {
    lines.push("| metric | previous | now | change |", "| --- | ---: | ---: | ---: |");
    for (const breach of breaches)
      lines.push(
        `| ${breach.metric} | ${breach.previous} | ${breach.now} | ${percent(breach.previous, breach.now)} |`,
      );
    for (const breach of breaches.filter((item) => item.offenders?.length)) {
      lines.push(
        "",
        `**${breach.metric}**`,
        "",
        ...breach.offenders.slice(0, 10).map((offender) => `- \`${offender}\``),
      );
    }
  }
  lines.push(
    "",
    "<details><summary>Top 20 programs by instantiations</summary>",
    "",
    "| config | instantiations | check s |",
    "| --- | ---: | ---: |",
  );
  for (const program of current.instantiations.programs.slice(0, 20))
    lines.push(`| ${program.config} | ${program.instantiations} | ${program.checkTime} |`);
  lines.push("", "</details>", "");
  return lines.join("\n");
}

/** What to do with the issue tracker: nothing, open an issue, or comment on the open one. */
export function planIssue({ breaches, openIssues, date, body }) {
  if (breaches.length === 0) return { kind: "none" };
  if (openIssues.length > 0) return { kind: "comment", issue: openIssues[0], body };
  return { kind: "open", title: `Codebase health: ${date} regressions`, label: ISSUE_LABEL, body };
}

function publishIssue({ breaches, date, body }) {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const openIssues =
    breaches.length === 0
      ? []
      : JSON.parse(
          gh(["issue", "list", "--label", ISSUE_LABEL, "--state", "open", "--json", "number"]),
        ).map((issue) => issue.number);
  const plan = planIssue({ breaches, openIssues, date, body });
  if (plan.kind === "comment") gh(["issue", "comment", String(plan.issue), "--body", plan.body]);
  if (plan.kind === "open") {
    gh([
      "label",
      "create",
      ISSUE_LABEL,
      "--force",
      "--description",
      "Nightly codebase health regressions",
    ]);
    gh(["issue", "create", "--title", plan.title, "--label", plan.label, "--body", plan.body]);
  }
  return plan;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)),
  );
  const read = (path) => (path && existsSync(path) ? readFileSync(path, "utf8") : "");
  const programs = read(args.metrics)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => typeof row.instantiations === "number");
  const commit =
    args.commit ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const current = buildHealth({
    date: new Date().toISOString().slice(0, 10),
    commit,
    programs,
    chain: longestReferenceChain({ root }),
    declarations: declarationFiles({ root }),
    architecture: parseArchitectureReport({ text: read(args.architecture) }),
    typecheck: parseTimeReport({ text: read(args.time) }),
  });
  const previousText = read(args.previous);
  const previous = previousText ? JSON.parse(previousText) : null;
  const breaches = compareHealth({ previous, current });
  const markdown = renderMarkdown({ previous, current, breaches });
  if ("dry-run" in args) {
    process.stdout.write(
      `${markdown}\n${planIssue({ breaches, openIssues: [], date: current.date, body: "" }).kind} (dry run: nothing written)\n`,
    );
    return;
  }
  writeFileSync(args.out ?? "health.json", `${JSON.stringify(current, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if ("publish" in args)
    process.stdout.write(
      `issue: ${publishIssue({ breaches, date: current.date, body: markdown }).kind}\n`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
