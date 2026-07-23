/**
 * The CLI's front door.
 *
 * Every `langwatch …` invocation lands here. It decides — from argv, env and
 * the shape of stdio, without loading commander or any command module — whether
 * a warm daemon can serve this call, and falls back to running the command
 * in-process otherwise.
 *
 * The fallback is not an error path. It is the DEFAULT path: with no daemon
 * running, this module connects to nothing, finds nothing, and hands over to
 * exactly the code that ran before daemon mode existed.
 */

import { execViaDaemon, requestStop } from "./client";
import {
  collectForwardedEnv,
  evaluateEligibility,
  isAutoSpawnEnabled,
  isDaemonDisabledByConfig,
  resolveColorLevel,
} from "./eligibility";
import { isSocketPathUsable, resolveBuildId, resolveIdentity } from "./identity";
import { spawnDaemon } from "./spawn";
import { recordMissAndDecideToSpawn } from "./spawn-hint";

declare const __CLI_VERSION__: string;

/**
 * `DEBUG=langwatch:daemon` (or any DEBUG containing "langwatch") turns the
 * fallback reasons into stderr lines. Off by default: a user who never asked
 * for a daemon must never learn that one exists because it failed.
 */
function debugLog(message: string): void {
  if (!process.env.DEBUG?.includes("langwatch")) return;
  process.stderr.write(`langwatch:daemon ${message}\n`);
}

/**
 * Run the CLI. Uses the daemon when it can, runs in-process when it cannot.
 */
export async function runCli(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  const eligibility = evaluateEligibility({
    args,
    env: process.env,
    daemonDisabledByConfig: isDaemonDisabledByConfig(process.env),
    stdoutIsTty: Boolean(process.stdout.isTTY),
    stderrIsTty: Boolean(process.stderr.isTTY),
    stdinIsTty: Boolean(process.stdin.isTTY),
    platform: process.platform,
  });

  if (!eligibility.eligible) {
    debugLog(`in-process (${eligibility.reason})`);
    await runInProcess(argv);
    return;
  }

  const identity = resolveIdentity(process.env);
  if (!isSocketPathUsable(identity.socketPath)) {
    debugLog("in-process (socket path too long for this platform)");
    await runInProcess(argv);
    return;
  }

  const env = collectForwardedEnv(process.env);
  const outcome = await execViaDaemon({
    socketPath: identity.socketPath,
    fingerprint: identity.fingerprint,
    cliVersion: __CLI_VERSION__,
    build: resolveBuildId(__CLI_VERSION__, argv[1] ?? ""),
    args,
    cwd: process.cwd(),
    env,
    colorLevel: resolveColorLevel(env),
  });

  if (outcome.served) {
    // Setting exitCode rather than calling process.exit() lets node flush
    // stdout before it goes. process.exit() with a pipe still holding buffered
    // writes truncates them — which would be a spectacular way to break
    // `--format json` for the exact agents this feature exists to serve.
    process.exitCode = outcome.exitCode;
    return;
  }

  debugLog(`in-process (${outcome.reason})`);

  if (outcome.evict) {
    // A daemon from another CLI version is answering on our socket. Ask it to
    // go away; the next invocation will find an empty socket and spawn a
    // correct one. We do not spawn a replacement here, because the old daemon
    // may still be unlinking its socket and the two would race for the bind.
    await requestStop(identity.socketPath);
  } else if (
    isAutoSpawnEnabled(process.env) &&
    argv[1] &&
    recordMissAndDecideToSpawn(identity)
  ) {
    spawnDaemon({ cliPath: argv[1], env, identity });
  }

  await runInProcess(argv);
}

/**
 * The pre-daemon code path, verbatim: build the commander tree and parse.
 *
 * Dynamically imported so that a daemon-served invocation never loads commander
 * or any command module — that module graph is ~80ms of the ~165ms cold start
 * this whole feature exists to remove, and a static import would make every
 * invocation pay it whether it needed it or not. (The CLI already loads every
 * command this way for the same reason.)
 */
async function runInProcess(argv: string[]): Promise<void> {
  const { buildProgram } = await import("../program.js");
  // parseAsync + await: a rejected action promise (e.g. an invalid --jq
  // expression surfacing from printResult outside a command's try/catch)
  // must become this call's rejection — a clean exit — not an unhandled
  // rejection with a raw stack.
  await buildProgram().parseAsync(argv);
}
