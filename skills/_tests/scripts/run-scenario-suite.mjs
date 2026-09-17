#!/usr/bin/env node
/**
 * Runs the skill dogfood scenarios as ONE run: generates a single
 * `SCENARIO_BATCH_RUN_ID` for every vitest worker, so scenarios land under
 * one Run. Dropped from spawned sub-processes, so agent-written runs don't merge in.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.resolve(testsDir, "..");

/**
 * The files a default pass leaves out: both need a whole instrumentation,
 * evaluation and test setup per fixture and take ~80/63 minutes alone. The
 * skills they cover are exercised elsewhere, so `--all` is what adds them back.
 */
const LONGEST_FILES = ["datasets.scenario.test.ts", "level-up.scenario.test.ts"];

/** How many files vitest runs at once. Each one holds a Claude Code session. */
const DEFAULT_WORKERS = 3;

function parseArguments(argv) {
  const args = { all: false, workers: DEFAULT_WORKERS, passthrough: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      args.all = true;
    } else if (argument === "--workers") {
      index += 1;
      args.workers = Number(argv[index]);
    } else {
      args.passthrough.push(argument);
    }
  }
  if (!Number.isInteger(args.workers) || args.workers < 1) {
    throw new Error("--workers takes a whole number of 1 or more");
  }
  return args;
}

const args = parseArguments(process.argv.slice(2));

// Only the scenario files report runs. The plain `*.test.ts` files assert over
// the compiled skills and the docs pages, so they have no place in a batch.
const scenarioFiles = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith(".scenario.test.ts"))
  .filter((name) => args.all || !LONGEST_FILES.includes(name))
  .toSorted()
  .map((name) => `_tests/${name}`);

if (scenarioFiles.length === 0) {
  console.error("No scenario files found in _tests/");
  process.exit(1);
}

// An id supplied by the caller joins an open batch, which is what a rerun of
// one file needs to land in the Run the rest of the suite already opened.
const batchRunId =
  process.env.SCENARIO_BATCH_RUN_ID ?? `scenariobatch_${randomBytes(6).toString("hex")}`;

console.log(`Batch run id: ${batchRunId}`);
console.log(`Files: ${scenarioFiles.length}, workers: ${args.workers}`);
if (!args.all) {
  console.log(`Left out (longest): ${LONGEST_FILES.join(", ")}`);
}
console.log(
  "Read the runs back with: langwatch simulation-run list " +
    `--batch-run-id ${batchRunId} --scenario-set-id skill-tests`,
);

const child = spawn(
  "pnpm",
  ["vitest", "run", `--maxWorkers=${args.workers}`, ...scenarioFiles, ...args.passthrough],
  {
    cwd: skillsDir,
    env: { ...process.env, SCENARIO_BATCH_RUN_ID: batchRunId },
    stdio: "inherit",
  },
);

child.on("close", (code) => {
  console.log(`\nBatch run id: ${batchRunId}`);
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
