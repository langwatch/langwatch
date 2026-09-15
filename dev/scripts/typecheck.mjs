#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const applications = new Map([
  ["api", "@langwatch/platform-api"],
  ["worker", "@langwatch/worker"],
  ["ui", "@langwatch/ui"],
]);

const args = process.argv.slice(2);
const fast = args[0] === "--fast";
if (fast) {
  args.shift();
}
const optionStart = args.findIndex((arg) => arg.startsWith("--"));
const targets = optionStart === -1 ? args : args.slice(0, optionStart);
const options = optionStart === -1 ? [] : args.slice(optionStart);
if (options[0] === "--") {
  options.shift();
}

const unknown = targets.filter((target) => !applications.has(target));
if (unknown.length > 0) {
  console.error(`Unknown application: ${unknown.join(", ")}. Choose api, worker, or ui.`);
  process.exit(2);
}

const selected = targets.length === 0 ? [...applications.keys()] : [...new Set(targets)];
const filters = selected.flatMap((target) => ["--filter", applications.get(target)]);
const child = spawn(
  "pnpm",
  ["--workspace-concurrency=1", ...filters, fast ? "typecheck:fast" : "typecheck", ...options],
  {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Could not start typecheck: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
