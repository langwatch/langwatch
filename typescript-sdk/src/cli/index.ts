#!/usr/bin/env node

// First side effect: turn on Node's compile cache so everything the boot
// path loads after this (dotenv, commander, …) compiles from cache on warm
// runs. Must precede every other import — see compileCache.ts.
import "./compileCache";

// Load environment variables before we DISPATCH. Note the limit of that
// promise: static imports are hoisted above this module's body (by ES module
// semantics, and by esbuild when tsup bundles), so `./daemon/dispatch` below
// is already evaluated by the time config() runs. Only function bodies called
// after this point see the loaded .env — never module-level side effects.
// Anything that must read env at module scope has to be lazily imported.
// Asserted in __tests__/index-boot.unit.test.ts.
import { config } from "dotenv";

/**
 * The ONE boot that must not absorb a .env: the daemon server. It is spawned
 * with cwd=$HOME (daemon/spawn.ts), so the boot-time load below would read
 * ~/.env — and the daemon's process env becomes the BASELINE every request
 * resets to (daemon/execution.ts applyWindow), which would drop the user's
 * home-directory secrets (DATABASE_URL, AWS creds, …) into every caller's
 * execution window. Identity-relevant variables the daemon actually needs are
 * pinned explicitly by the spawner (daemon/identity.ts identityEnv); per
 * request, the caller's own .env is re-read scoped to LANGWATCH_* keys
 * (utils/apiKey.ts). Every other invocation keeps the full load.
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
 * The entrypoint is deliberately almost empty.
 *
 * The command tree lives in `./program.ts` and is loaded lazily, because an
 * invocation that a warm daemon can serve should never pay for commander, the
 * client SDK, or any command module — that graph is most of the cold start.
 *
 * `runCli` falls back to building and parsing the program in-process whenever a
 * daemon is unavailable, disabled, or unsuitable for this command, which is the
 * default and is byte-for-byte what the CLI did before daemon mode existed.
 */
/**
 * Top-level safety net. Commands render their own errors (structured on
 * stdout / human on stderr) and exit themselves; this catch exists only for
 * failures that escape the command tree entirely — e.g. a rejected action
 * promise a command forgot to catch (an invalid --jq expression outside a
 * try/catch). Kept dependency-free on purpose: statically importing the error
 * renderer would pull the program graph into every invocation, daemon-served
 * ones included, and cold start is the whole point of the lazy imports above.
 */
void runCli(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
