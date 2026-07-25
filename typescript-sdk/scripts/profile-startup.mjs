#!/usr/bin/env node
/**
 * profile-startup — what does one CLI invocation actually load and run?
 *
 * For a given CLI argv (default `--help`, always with LANGWATCH_NO_DAEMON=1
 * so the in-process path is what is measured) this produces, in
 * `typescript-sdk/.startup-profile/`:
 *
 *   <label>-require-tree.json   timed require tree (every external module,
 *                               with parent links, self + total time)
 *   <label>-require-tree.txt    top-30 tables (by total, by self)
 *   <label>-speedscope.json     CPU profile in speedscope format — drop it
 *                               onto https://speedscope.app
 *   <label>-wall.txt            median wall time over --runs runs
 *
 * Usage:
 *   node scripts/profile-startup.mjs                       # --help
 *   node scripts/profile-startup.mjs whoami
 *   node scripts/profile-startup.mjs skills list
 *   node scripts/profile-startup.mjs --runs 10 --binary --help
 *
 * Flags:
 *   --runs N    wall-time repetitions for the median (default 10)
 *   --binary    also time dist/bin/langwatch (skipped gracefully if absent;
 *               the bun binary is never rebuilt from here — it takes minutes)
 *   --label L   output file prefix (default: the argv joined with '-')
 *
 * Requires the built dist: run `pnpm build` first.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(SDK_ROOT, "dist", "cli", "index.js");
const BINARY = path.join(SDK_ROOT, "dist", "bin", "langwatch");
const HOOK = path.join(SDK_ROOT, "scripts", "startup-require-hook.cjs");
const OUT_DIR = path.join(SDK_ROOT, ".startup-profile");

// ---------------------------------------------------------------- argv ----
const rawArgs = process.argv.slice(2);
let runs = 10;
let useBinary = false;
let label;
const cliArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--runs") runs = Number(rawArgs[++i]);
  else if (arg === "--binary") useBinary = true;
  else if (arg === "--label") label = rawArgs[++i];
  else cliArgs.push(arg);
}
if (cliArgs.length === 0) cliArgs.push("--help");
label ??= cliArgs.join("-").replace(/^-+/, "").replaceAll("/", "-") || "help";

if (!fs.existsSync(CLI_ENTRY)) {
  console.error(`dist not built: ${CLI_ENTRY} missing. Run \`pnpm build\` first.`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const childEnv = {
  ...process.env,
  LANGWATCH_NO_DAEMON: "1",
  FORCE_COLOR: "0",
};

// ------------------------------------------------------------- helpers ----
const runNode = (extraNodeArgs, env = {}) =>
  spawnSync(process.execPath, [...extraNodeArgs, CLI_ENTRY, ...cliArgs], {
    env: { ...childEnv, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const timeRuns = (command, commandArgs) => {
  const samples = [];
  // One warmup run so the first (cold FS-cache) sample doesn't skew min/max.
  spawnSync(command, commandArgs, {
    env: childEnv,
    stdio: ["ignore", "ignore", "ignore"],
  });
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const result = spawnSync(command, commandArgs, {
      env: childEnv,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const elapsed = performance.now() - start;
    if (result.error) throw result.error;
    samples.push(elapsed);
  }
  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
};

// ----------------------------------------------- cpuprofile → speedscope ----
/**
 * The V8 .cpuprofile is already samples + deltas; speedscope's "sampled"
 * format is the same idea with frames hoisted into a shared table. This is a
 * mechanical re-index, nothing clever.
 */
const convertCpuProfile = (cpuprofile, name) => {
  const nodeById = new Map(cpuprofile.nodes.map((node) => [node.id, node]));
  // cpuprofile nodes link downwards (children); samples reference the LEAF
  // node, so the full stack is reconstructed by walking parents up.
  const parentById = new Map();
  for (const node of cpuprofile.nodes) {
    for (const child of node.children ?? []) parentById.set(child, node.id);
  }

  const frameIndexByNodeId = new Map();
  const frames = [];
  const frameIndex = (nodeId) => {
    let index = frameIndexByNodeId.get(nodeId);
    if (index !== undefined) return index;
    const frame = nodeById.get(nodeId)?.callFrame ?? {
      functionName: `(unknown ${nodeId})`,
      url: "",
      lineNumber: -1,
      columnNumber: -1,
    };
    index = frames.length;
    frames.push({
      name: frame.functionName || "(anonymous)",
      file: frame.url,
      line: frame.lineNumber >= 0 ? frame.lineNumber + 1 : undefined,
      col: frame.columnNumber >= 0 ? frame.columnNumber + 1 : undefined,
    });
    frameIndexByNodeId.set(nodeId, index);
    return index;
  };

  const stackCache = new Map();
  const stackFor = (leafId) => {
    const cached = stackCache.get(leafId);
    if (cached) return cached;
    const ids = [];
    for (let id = leafId; id !== undefined && !ids.includes(id); id = parentById.get(id)) {
      ids.push(id);
    }
    const stack = ids.reverse().map(frameIndex);
    stackCache.set(leafId, stack);
    return stack;
  };

  const samples = (cpuprofile.samples ?? []).map(stackFor);
  const weights = (cpuprofile.timeDeltas ?? []).map((delta) => Math.max(delta, 0));
  const endValue = weights.reduce((sum, weight) => sum + weight, 0);

  return {
    $schema: "https://www.speedscope.app/file-format-schema.json",
    exporter: "langwatch profile-startup.mjs",
    name,
    activeProfileIndex: 0,
    shared: { frames },
    profiles: [
      {
        type: "sampled",
        name,
        unit: "microseconds",
        startValue: 0,
        endValue,
        samples,
        weights,
      },
    ],
  };
};

// ------------------------------------------------- require-tree rendering ----
const renderTopTables = (tree) => {
  const lines = [];
  const pushTable = (title, rows) => {
    lines.push(`\n${title}`);
    lines.push("  selfMs   totalMs  count  module");
    for (const row of rows) {
      lines.push(
        `  ${row.selfMs.toFixed(1).padStart(7)}  ${row.totalMs.toFixed(1).padStart(8)}  ${String(row.count).padStart(5)}  ${shorten(row.id)}`,
      );
    }
  };
  const shorten = (id) => {
    const nm = id.split("node_modules/");
    return nm.length > 1 ? nm[nm.length - 1] : id.replace(SDK_ROOT, "<sdk>");
  };
  const byTotal = [...tree.flat].sort((a, b) => b.totalMs - a.totalMs).slice(0, 30);
  const bySelf = [...tree.flat].sort((a, b) => b.selfMs - a.selfMs).slice(0, 30);
  lines.push(`node boot (preload → first require): ${tree.nodeBootMs.toFixed(1)}ms`);
  lines.push(`modules loaded: ${tree.moduleCount}`);
  pushTable("TOP 30 BY TOTAL TIME (load + everything it pulled in)", byTotal);
  pushTable("TOP 30 BY SELF TIME (its own parse/eval only)", bySelf);
  return lines.join("\n");
};

// ------------------------------------------------------------------ run ----
console.log(`profiling: langwatch ${cliArgs.join(" ")}  (LANGWATCH_NO_DAEMON=1, ${runs} wall runs)`);

// 1. require tree
const treePath = path.join(OUT_DIR, `${label}-require-tree.json`);
const treeResult = runNode(["--require", HOOK], { LANGWATCH_STARTUP_TREE_OUT: treePath });
if (treeResult.status !== 0 && !fs.existsSync(treePath)) {
  console.error(`require-tree run failed (exit ${treeResult.status})`);
  process.exit(treeResult.status ?? 1);
}
const tree = JSON.parse(fs.readFileSync(treePath, "utf8"));
const treeText = renderTopTables(tree);
fs.writeFileSync(path.join(OUT_DIR, `${label}-require-tree.txt`), treeText + "\n");
console.log(treeText);

// 2. CPU profile → speedscope
const profDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cpuprof-"));
const profResult = runNode(["--cpu-prof", `--cpu-prof-dir=${profDir}`]);
if (profResult.status !== 0) {
  console.error(`cpu-prof run failed (exit ${profResult.status})`);
} else {
  const profFile = fs.readdirSync(profDir).find((f) => f.endsWith(".cpuprofile"));
  if (profFile) {
    const cpuprofile = JSON.parse(fs.readFileSync(path.join(profDir, profFile), "utf8"));
    const speedscope = convertCpuProfile(cpuprofile, `langwatch ${cliArgs.join(" ")}`);
    const out = path.join(OUT_DIR, `${label}-speedscope.json`);
    fs.writeFileSync(out, JSON.stringify(speedscope));
    console.log(`\nspeedscope: ${out}`);
  }
}
fs.rmSync(profDir, { recursive: true, force: true });

// 3. wall time (plain runs — no hooks, no profiler)
const nodeWall = timeRuns(process.execPath, [CLI_ENTRY, ...cliArgs]);
const bootWall = timeRuns(process.execPath, ["-e", ""]);
let wallText = `node dist/cli/index.js ${cliArgs.join(" ")}\n`;
wallText += `  median ${nodeWall.median.toFixed(1)}ms  (min ${nodeWall.min.toFixed(1)}, max ${nodeWall.max.toFixed(1)}, ${runs} runs)\n`;
wallText += `node -e "" (boot baseline)\n`;
wallText += `  median ${bootWall.median.toFixed(1)}ms\n`;
wallText += `startup above node boot: ${(nodeWall.median - bootWall.median).toFixed(1)}ms\n`;

// 4. optional bun binary (wall only — node profiling flags do not apply)
if (useBinary) {
  if (fs.existsSync(BINARY)) {
    const binWall = timeRuns(BINARY, cliArgs);
    wallText += `dist/bin/langwatch ${cliArgs.join(" ")}\n`;
    wallText += `  median ${binWall.median.toFixed(1)}ms  (min ${binWall.min.toFixed(1)}, max ${binWall.max.toFixed(1)})\n`;
  } else {
    wallText += `dist/bin/langwatch: not present, skipped (not rebuilt — that takes minutes)\n`;
  }
}

fs.writeFileSync(path.join(OUT_DIR, `${label}-wall.txt`), wallText);
console.log(`\n${wallText}`);
console.log(`all outputs in ${OUT_DIR}`);
