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
import { gzipSync } from "node:zlib";

export const PROGRAM_GROWTH_RATIO = 0.25;
export const PROGRAM_GROWTH_FLOOR = 100_000;
export const TOTAL_INSTANTIATIONS_RATIO = 0.1;
export const CHAIN_DEPTH_STEP = 1;
export const DECLARATION_SIZE_RATIO = 0.1;
export const LARGE_DECLARATION_BYTES = 200 * 1024;
export const ISSUE_LABEL = "codebase-health";
export const DASHBOARD_LABEL = "codebase-health-dashboard";
export const BUNDLE_GROWTH_RATIO = 0.1;
export const LARGE_CHUNK_BYTES = 500 * 1024;
export const TYPECHECK_ERROR_LINES = 5;
export const HOT_SPOTS_KEPT = 5;
export const TREND_PROGRAMS = 15;

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

/** The typecheck outcome: exit code, error count and the first error lines. */
export function parseTypecheckLog({ text, exitCode }) {
  const errors = text.split("\n").filter((line) => /error TS\d+/.test(line));
  return {
    exitCode,
    errorCount: errors.length,
    errorLines: errors.slice(0, TYPECHECK_ERROR_LINES),
  };
}

/** A chunk name without its content hash, so a rebuilt chunk is still the same chunk. */
export function chunkName({ file }) {
  return file.replace(/^.*\//, "").replace(/[-.][A-Za-z0-9_-]{8}(\.[a-z]+)$/, "$1");
}

/** JS and CSS sizes, gzipped entry size and largest chunks of a vite output directory. */
export function measureBundle({ dir }) {
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push({ file: relative(dir, path), bytes: statSync(path).size });
    }
  };
  walk(dir);
  const js = files.filter((item) => /\.[mc]?js$/.test(item.file));
  const css = files.filter((item) => item.file.endsWith(".css"));
  const indexPath = join(dir, "index.html");
  const html = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  const entryFiles = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)]
    .map((match) => match[1].replace(/^\/+/, ""))
    .filter((file) => existsSync(join(dir, file)));
  const bySize = js.toSorted((a, b) => b.bytes - a.bytes);
  return {
    failed: false,
    totalJsBytes: js.reduce((sum, item) => sum + item.bytes, 0),
    totalCssBytes: css.reduce((sum, item) => sum + item.bytes, 0),
    entryFiles,
    entryGzipBytes: entryFiles.reduce(
      (sum, file) => sum + gzipSync(readFileSync(join(dir, file))).length,
      0,
    ),
    largest: bySize.slice(0, 10),
    overLimit: bySize.filter((item) => item.bytes > LARGE_CHUNK_BYTES),
  };
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
  typecheckResult = { exitCode: 0, errorCount: 0, errorLines: [] },
  bundle = null,
  testRepoSeconds = null,
}) {
  const failed = typecheckResult.exitCode !== 0;
  const sorted = programs.toSorted((a, b) => b.instantiations - a.instantiations);
  const bySize = declarations.toSorted((a, b) => b.bytes - a.bytes);
  return {
    date,
    commit,
    instantiations: {
      total: programs.reduce((sum, program) => sum + (program.instantiations ?? 0), 0),
      programs: sorted.map(
        ({
          config,
          instantiations,
          types,
          symbols,
          checkTime,
          memoryUsed,
          hotFiles,
          hotRelations,
          hotGenerics,
        }) => ({
          config,
          instantiations,
          types,
          symbols,
          checkTime,
          memoryUsed,
          hotFiles: (hotFiles ?? []).slice(0, HOT_SPOTS_KEPT),
          hotRelations: (hotRelations ?? []).slice(0, HOT_SPOTS_KEPT),
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
    typecheck: failed
      ? { wallSeconds: null, peakRssKb: null, ...typecheckResult, reliable: false }
      : { ...typecheck, ...typecheckResult, reliable: true },
    bundle,
    testRepo: { wallSeconds: testRepoSeconds },
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

function typecheckBreaches({ current }) {
  const { exitCode, errorCount, errorLines } = current.typecheck;
  if (!exitCode) return [];
  return [
    {
      metric: `typecheck failed on main: ${errorCount} errors`,
      previous: 0,
      now: errorCount,
      offenders: errorLines,
    },
  ];
}

function bundleBreaches({ previous, current }) {
  const now = current.bundle;
  if (now?.failed) return [{ metric: "UI build failed", previous: 0, now: 1 }];
  const before = previous?.bundle;
  if (!now || !before || before.failed) return [];
  const breaches = [];
  for (const [metric, field] of [
    ["UI JS total bytes", "totalJsBytes"],
    ["UI entry gzip bytes", "entryGzipBytes"],
  ])
    if (ratio(before[field], now[field]) > BUNDLE_GROWTH_RATIO)
      breaches.push({ metric, previous: before[field], now: now[field] });
  const known = new Set(before.overLimit.map((item) => chunkName({ file: item.file })));
  for (const item of now.overLimit.filter((chunk) => !known.has(chunkName({ file: chunk.file }))))
    breaches.push({ metric: `UI chunk over 500 KB ${item.file}`, previous: 0, now: item.bytes });
  return breaches;
}

/** The rows that crossed a threshold; a failed typecheck or build counts without a previous run. */
export function compareHealth({ previous, current }) {
  const failures = [...typecheckBreaches({ current }), ...bundleBreaches({ previous, current })];
  if (!previous) return failures;
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
    ...typecheckBreaches({ current }),
    ...breaches,
    ...architectureBreaches({ previous, current }),
    ...declarationBreaches({ previous, current }),
    ...bundleBreaches({ previous, current }),
  ];
}

const percent = (previous, now) =>
  previous > 0 ? `${(((now - previous) / previous) * 100).toFixed(1)}%` : "new";
const cell = (value) => (value === null || value === undefined ? "n/a" : String(value));

/** Every tracked number by name, null where it was not measured. */
export function metricValues({ health }) {
  const bundle = health?.bundle && !health.bundle.failed ? health.bundle : null;
  const values = {
    "instantiations total": health?.instantiations?.total,
    "reference chain depth": health?.chain?.depth,
    ".d.ts total bytes": health?.declarations?.totalBytes,
    "typecheck wall seconds": health?.typecheck?.wallSeconds,
    "typecheck peak RSS KB": health?.typecheck?.peakRssKb,
    "typecheck errors": health?.typecheck?.errorCount,
    "test:repo wall seconds": health?.testRepo?.wallSeconds,
    "UI JS total bytes": bundle?.totalJsBytes,
    "UI CSS total bytes": bundle?.totalCssBytes,
    "UI entry gzip bytes": bundle?.entryGzipBytes,
    "UI largest chunk bytes": bundle?.largest?.[0]?.bytes,
  };
  for (const [policy, count] of Object.entries(health?.architecture ?? {}))
    values[`architecture ${policy}`] = count;
  return values;
}

const change = (old, now) => (old == null || now == null ? "n/a" : percent(old, now));

/** The per-program numbers the trend table compares, by config. */
function programsByConfig({ health }) {
  return new Map(
    (health?.instantiations?.programs ?? []).map((program) => [program.config, program]),
  );
}

const megabytes = (kilobytes) => (kilobytes == null ? null : Math.round(kilobytes / 1024));

/**
 * The heaviest programs tonight, each against itself 1, 7 and 30 days ago, and
 * their hot spots: the slowest files to check and the slowest type relations.
 */
export function renderProgramTrends({
  current,
  previous,
  weekAgo,
  monthAgo,
  limit = TREND_PROGRAMS,
}) {
  const older = [previous, weekAgo, monthAgo].map((health) => programsByConfig({ health }));
  const programs = current.instantiations.programs.slice(0, limit);
  const lines = [
    "### Typecheck trends",
    "",
    `The ${programs.length} programs with the most type instantiations. Each change is against the same program 1, 7 and 30 days ago.`,
    "",
    "| program | instantiations | 1d | 7d | 30d | check s | 1d | 7d | 30d | memory MB | 30d | types | symbols |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const program of programs) {
    const then = older.map((byConfig) => byConfig.get(program.config));
    const deltas = (field) => then.map((old) => change(old?.[field], program[field]));
    lines.push(
      `| ${program.config} | ${cell(program.instantiations)} | ${deltas("instantiations").join(" | ")} | ${cell(program.checkTime)} | ${deltas("checkTime").join(" | ")} | ${cell(megabytes(program.memoryUsed))} | ${change(then[2]?.memoryUsed, program.memoryUsed)} | ${cell(program.types)} | ${cell(program.symbols)} |`,
    );
  }
  const spots = programs.filter(
    (program) => program.hotFiles?.length > 0 || program.hotRelations?.length > 0,
  );
  if (spots.length > 0) {
    lines.push("", "<details><summary>Hot spots per program</summary>", "");
    for (const program of spots) {
      lines.push(`**${program.config}**`, "");
      for (const [file, ms] of program.hotFiles ?? []) lines.push(`- file \`${file}\` ${ms} ms`);
      for (const relation of program.hotRelations ?? [])
        lines.push(`- relation \`${relation.source}\` to \`${relation.target}\` ${relation.ms} ms`);
      lines.push("");
    }
    lines.push("</details>");
  }
  lines.push("");
  return lines.join("\n");
}

/** Codebase health's section of the nightly dashboard, rewritten each night. */
export function renderDashboard({ current, previous, weekAgo, monthAgo = null, breachIssues }) {
  const tonight = metricValues({ health: current });
  const last = metricValues({ health: previous });
  const week = metricValues({ health: weekAgo });
  const month = metricValues({ health: monthAgo });
  const lines = [
    `## Codebase health`,
    "",
    `Measured ${current.date} on commit \`${current.commit.slice(0, 10)}\`.`,
    "",
    "| metric | tonight | change vs last night | change vs 7 days ago | change vs 30 days ago |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [metric, now] of Object.entries(tonight))
    lines.push(
      `| ${metric} | ${cell(now)} | ${change(last[metric], now)} | ${change(week[metric], now)} | ${change(month[metric], now)} |`,
    );
  lines.push("", renderProgramTrends({ current, previous, weekAgo, monthAgo }));
  lines.push("### Open breach issues", "");
  if (breachIssues.length === 0) lines.push("None.");
  for (const issue of breachIssues) lines.push(`- ${issue.url} ${issue.title}`);
  lines.push("");
  return lines.join("\n");
}

export const DASHBOARD_TITLE = "Nightly dashboard";

/**
 * Create the dashboard issue, or rewrite the body of the open one. Codebase
 * health opened it; the nightly suite (.github/workflows/nightly.yml) now
 * writes it, with this job's section among the others.
 */
export function planDashboard({ openIssues, body }) {
  if (openIssues.length === 0)
    return { kind: "create", title: DASHBOARD_TITLE, label: DASHBOARD_LABEL, body };
  return { kind: "edit", issue: openIssues[0], title: DASHBOARD_TITLE, body };
}

function comparisonRows({ previous, current }) {
  const before = metricValues({ health: previous });
  return Object.entries(metricValues({ health: current })).map(([metric, now]) => {
    const unseenPolicy = previous && metric.startsWith("architecture ") ? 0 : null;
    return [metric, before[metric] ?? unseenPolicy, now];
  });
}

/** The markdown the job summary and the issue share. */
export function renderMarkdown({ previous, current, breaches }) {
  const lines = [`## Codebase health ${current.date} (${current.commit.slice(0, 10)})`, ""];
  if (!previous)
    lines.push("No previous run to compare with; tonight's numbers are the baseline.", "");
  const rows = comparisonRows({ previous, current });
  if (!current.typecheck.reliable)
    lines.push("The typecheck failed, so its time and memory are not compared.", "");
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
export function planIssue({
  breaches,
  openIssues,
  date,
  body,
  label = ISSUE_LABEL,
  subject = "Codebase health",
}) {
  if (breaches.length === 0) return { kind: "none" };
  if (openIssues.length > 0) return { kind: "comment", issue: openIssues[0], body };
  return { kind: "open", title: `${subject}: ${date} regressions`, label, body };
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

/** Open issues carrying a label, with the fields asked for. */
export function listOpenIssues({ label, fields }) {
  return JSON.parse(gh(["issue", "list", "--label", label, "--state", "open", "--json", fields]));
}

/** Open an issue for tonight's breaches, or comment on the open one with the label. */
export function publishIssue({
  breaches,
  date,
  body,
  label = ISSUE_LABEL,
  subject = "Codebase health",
  description = "Nightly codebase health regressions",
}) {
  const openIssues =
    breaches.length === 0
      ? []
      : listOpenIssues({ label, fields: "number" }).map((issue) => issue.number);
  const plan = planIssue({ breaches, openIssues, date, body, label, subject });
  if (plan.kind === "comment") gh(["issue", "comment", String(plan.issue), "--body", plan.body]);
  if (plan.kind === "open") {
    gh(["label", "create", label, "--force", "--description", description]);
    gh(["issue", "create", "--title", plan.title, "--label", plan.label, "--body", plan.body]);
  }
  return plan;
}

/** Write the one pinned dashboard issue's body, creating and pinning it if it is absent. */
export function publishDashboard({ body }) {
  const plan = planDashboard({
    openIssues: listOpenIssues({ label: DASHBOARD_LABEL, fields: "number" }).map(
      (issue) => issue.number,
    ),
    body,
  });
  const file = "dashboard-issue-body.md";
  writeFileSync(file, plan.body);
  let number = plan.issue;
  if (plan.kind === "create") {
    gh([
      "label",
      "create",
      DASHBOARD_LABEL,
      "--force",
      "--description",
      "Pinned nightly health table",
    ]);
    const url = gh([
      "issue",
      "create",
      "--title",
      plan.title,
      "--label",
      plan.label,
      "--body-file",
      file,
    ]).trim();
    number = Number(url.split("/").pop());
  } else gh(["issue", "edit", String(number), "--title", plan.title, "--body-file", file]);
  try {
    const id = gh(["issue", "view", String(number), "--json", "id", "--jq", ".id"]).trim();
    gh([
      "api",
      "graphql",
      "-f",
      `query=mutation { pinIssue(input: {issueId: "${id}"}) { issue { id } } }`,
    ]);
  } catch {
    // Pinning is best effort: it fails when the issue is already pinned or the limit is reached.
  }
  return plan;
}

const measureBundleIn = ({ dir }) => (dir ? measureBundle({ dir }) : null);

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
  const exitOf = (path) => (read(path).trim() === "" ? 0 : Number(read(path).trim()));
  const bundleDir = args["bundle-dir"] ? resolve(args["bundle-dir"]) : null;
  const buildFailed = exitOf(args["bundle-exit"]) !== 0;
  const current = buildHealth({
    date: new Date().toISOString().slice(0, 10),
    commit,
    programs,
    chain: longestReferenceChain({ root }),
    declarations: declarationFiles({ root }),
    architecture: parseArchitectureReport({ text: read(args.architecture) }),
    typecheck: parseTimeReport({ text: read(args.time) }),
    typecheckResult: parseTypecheckLog({
      text: read(args["typecheck-log"]),
      exitCode: exitOf(args["typecheck-exit"]),
    }),
    bundle: buildFailed ? { failed: true } : measureBundleIn({ dir: bundleDir }),
    testRepoSeconds: read(args["test-repo-seconds"]).trim()
      ? Number(read(args["test-repo-seconds"]).trim())
      : null,
  });
  const readJson = (path) => (read(path) ? JSON.parse(read(path)) : null);
  const previous = readJson(args.previous);
  const weekAgo = readJson(args.weekago);
  const monthAgo = readJson(args.monthago);
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
  // `--publish=false` is how a trial run from a branch keeps its hands off the issues.
  const publishing = "publish" in args && args.publish !== "false";
  if (publishing)
    process.stdout.write(
      `issue: ${publishIssue({ breaches, date: current.date, body: markdown }).kind}\n`,
    );
  let breachIssues = [];
  try {
    breachIssues = listOpenIssues({ label: ISSUE_LABEL, fields: "number,title,url" });
  } catch {
    // Reading the issues is best effort: without a token the section lists none.
  }
  // This job's section of the nightly dashboard; the nightly suite's last job publishes it.
  const section = renderDashboard({ current, previous, weekAgo, monthAgo, breachIssues });
  writeFileSync(args.dashboard ?? "dashboard-body.md", section);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
