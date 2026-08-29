import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { planTestColocation } from "./test-colocation";

const USAGE = `Usage:
  pnpm refactor:colocate-tests [--root DIR] [--write]

Moves every strict feature package's tests/ tree into __tests__ directories
beside the code each test covers, rewriting the relative imports that the move
invalidates. Without --write it prints the plan and changes nothing.

A test whose subject cannot be read off its own imports is reported and LEFT
ALONE, because a guessed home reads as a deliberate one afterwards.`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const rootFlag = argv.indexOf("--root");
const root = resolve(rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? "."));
const write = argv.includes("--write");

const plan = planTestColocation(root);
const show = (path: string) => relative(root, path);

if (plan.collisions.length > 0) {
  process.stderr.write(
    `colocate-tests: ${plan.collisions.length} collision(s); nothing moved.\n${plan.collisions
      .map((collision) => `  ${collision}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

for (const { file, reason } of plan.unresolved) {
  process.stdout.write(`unresolved  ${show(file)}\n            ${reason}\n`);
}

if (!write) {
  for (const move of plan.moves) {
    process.stdout.write(`would move  ${show(move.from)}\n         -> ${show(move.to)}\n`);
  }
  process.stdout.write(
    `\n${plan.moves.length} file(s) would move, ${plan.unresolved.length} left alone.\n`,
  );
  process.exit(0);
}

for (const move of plan.moves) {
  mkdirSync(dirname(move.to), { recursive: true });
  execFileSync("git", ["-C", root, "mv", move.from, move.to], { stdio: ["ignore", "ignore", "pipe"] });
  const edited = plan.edits.get(move.from);
  if (edited !== undefined) writeFileSync(move.to, edited);
}

process.stdout.write(
  `colocate-tests: moved ${plan.moves.length} file(s), left ${plan.unresolved.length} alone.\n`,
);
