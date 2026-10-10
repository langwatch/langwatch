#!/usr/bin/env node

// First side effect: turn on Node's compile cache so everything the boot
// path loads after this (dotenv, commander, …) compiles from cache on warm
// runs. Must precede every other import — see compileCache.ts.
import "./compileCache";
// Loads env before DISPATCH -- but static imports are hoisted above this
// body, so `./daemon/dispatch` below is already evaluated by then. Only
// function bodies called after this point see the loaded .env; module-scope
// env reads must be lazily imported. Asserted in __tests__/index-boot.unit.test.ts.
import { config } from "dotenv";

/**
 * The ONE boot that must not absorb a .env: the daemon server runs with
 * cwd=$HOME, so loading here would leak home-directory secrets into the
 * BASELINE every request resets to. Every other invocation loads normally.
 */
const isDaemonServerBoot =
  process.argv[2] === "daemon" &&
  process.argv[3] === "start" &&
  process.argv.includes("--foreground");

// quiet: silence dotenv's "injecting env" tip line on every CLI run.
if (!isDaemonServerBoot) {
  config({ quiet: true });
}

import { runCli } from "./daemon/dispatch";

/**
 * The entrypoint is deliberately almost empty: the command tree in
 * `./program.ts` loads lazily so a daemon-served invocation never pays for
 * commander or the client SDK — most of the cold start.
 */

/**
 * Top-level safety net for a promise that escapes the command tree
 * uncaught. Kept dependency-free — importing the error renderer here would
 * defeat the lazy imports above and pull the whole program graph in.
 */
void runCli(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
