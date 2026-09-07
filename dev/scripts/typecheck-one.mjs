#!/usr/bin/env node
// Package scripts own declaration prerequisites and the test/check configuration.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error("Name the package to check: pnpm typecheck:one <package-name-or-directory>.");
  process.exit(2);
}

const directory = resolve(root, target);
const byDirectory = existsSync(join(directory, "package.json"));
const filters = byDirectory ? [] : ["--filter", target, "--fail-if-no-match"];
const child = spawn("pnpm", [...filters, "run", "typecheck", ...process.argv.slice(3)], {
  cwd: byDirectory ? directory : root,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
