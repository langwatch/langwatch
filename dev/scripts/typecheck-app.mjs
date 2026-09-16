#!/usr/bin/env node
// Runs both typecheck phases unconditionally (declarations pre-pass, then
// source/test compile): neither phase's failure hides the other, and each
// is banner-attributed so a failure names which phase produced it.
import { spawn } from "node:child_process";

const [declarationsProject, testProject, ...extraTscArgs] = process.argv.slice(2);

if (!declarationsProject || !testProject) {
  console.error(
    "Usage: typecheck-app.mjs <declarations-project> <test-tsconfig> [tsc-args...]",
  );
  process.exit(2);
}

function run(command, args, label) {
  console.error(`\n--- typecheck: ${label} ---`);
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "inherit" });
    const handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => child.kill(signal)]),
    );
    for (const [name, handler] of handlers) {
      process.on(name, handler);
    }
    child.on("error", (error) => {
      console.error(`${label}: ${error.message}`);
      done(1);
    });
    child.on("exit", (code, signal) => {
      for (const [name, handler] of handlers) {
        process.off(name, handler);
      }
      done(signal ? 1 : (code ?? 1));
    });
  });
}

async function main() {
  const declarationsCode = await run(
    "pnpm",
    ["-w", "typecheck:declarations", "--project", declarationsProject],
    "declarations",
  );
  const testCode = await run(
    "tsc",
    ["--noEmit", "-p", testProject, ...extraTscArgs],
    "source + tests",
  );

  if (declarationsCode !== 0) {
    console.error(`\ntypecheck: declarations phase failed (exit ${declarationsCode}).`);
  }
  if (testCode !== 0) {
    console.error(`\ntypecheck: source + tests phase failed (exit ${testCode}).`);
  }

  return declarationsCode !== 0 || testCode !== 0 ? 1 : 0;
}

process.exitCode = await main();
