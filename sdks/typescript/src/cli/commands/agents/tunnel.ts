/**
 * `langwatch agent tunnel` (hidden alias `agent dev`): expose a local agent
 * server through a public tunnel and repoint a registered HTTP agent at it,
 * so platform scenarios run against the local process. Ctrl-C restores the
 * previous URL.
 *
 * The session phases live in `./tunnel/`: input resolution, the local auth
 * proxy, quick-tunnel provisioning, and the config write-back / restore.
 */

import * as crypto from "node:crypto";
import chalk from "chalk";
import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { type AuthProxy, startAuthProxy } from "./tunnel/auth-proxy";
import { startQuickTunnel, type TunnelHandle } from "./tunnel/quick-tunnel";
import {
  fail,
  rememberAgentForDirectory,
  resolveLocalUrl,
  resolveTargetAgent,
} from "./tunnel/resolve";
import {
  applyDevTunnel,
  deriveSimulationsUrl,
  restoreDevTunnel,
  touchDevTunnel,
} from "./tunnel/write-back";

/** How often the session probes the tunnel end to end. */
const HEALTH_INTERVAL_MS = 30_000;

/** Unhealthy probes in a row before the tunnel is declared dead. */
const HEALTH_FAILURE_THRESHOLD = 3;

/**
 * How long one probe may take. A half-open socket at the edge is exactly the
 * failure the monitor looks for, and it is also the case where `fetch` never
 * settles. The next check is chained off the current one, so an unbounded
 * probe would stop the monitor for the rest of the session.
 */
const HEALTH_PROBE_TIMEOUT_MS = 10_000;

/** How long a repeated signal waits for the in-flight restore before forcing exit. */
const FORCE_EXIT_GRACE_MS = 2_000;

/**
 * The keep-alive tick. Long enough to cost nothing, short enough to stay well
 * inside the platform limit on a timer delay.
 */
const KEEP_ALIVE_INTERVAL_MS = 60_000;

export interface AgentTunnelOptions {
  port?: string;
  url?: string;
  agent?: string;
  tunnelUrl?: string;
  /** commander `--no-update-url`: false when the flag is passed. */
  updateUrl?: boolean;
  /** commander `--no-auth`: false when the flag is passed. */
  auth?: boolean;
  apiKey?: string;
}

export interface AgentTunnelSession {
  /** Resolves with the exit code once shutdown finishes. */
  done: Promise<number>;
  shutdown: (code?: number) => Promise<void>;
}

/** Test hooks for `startAgentTunnelSession`; sessions use the defaults. */
export interface AgentTunnelSessionHooks {
  healthIntervalMs?: number;
  healthProbeTimeoutMs?: number;
}

function printBanner({
  tunnelUrl,
  localUrl,
  agent,
  previousUrl,
  updatedUrl,
}: {
  tunnelUrl: string;
  localUrl: string;
  agent: AgentResponse;
  previousUrl?: string;
  updatedUrl: boolean;
}): void {
  console.log();
  console.log(
    `${chalk.green("Tunnel up:")} ${chalk.cyan(tunnelUrl)} ${chalk.gray("->")} ${chalk.cyan(localUrl)}`,
  );
  if (updatedUrl) {
    console.log(
      `Agent ${chalk.bold(`"${agent.name}"`)} now points at your machine${
        previousUrl ? chalk.gray(` (was ${previousUrl})`) : ""
      }.`,
    );
    const simulationsUrl = deriveSimulationsUrl(agent.platformUrl);
    if (simulationsUrl) {
      console.log(`Run your scenarios: ${chalk.cyan(simulationsUrl)}`);
    }
    console.log(chalk.gray("Ctrl-C restores the previous URL."));
  } else {
    console.log(
      chalk.gray(
        `--no-update-url: agent "${agent.name}" was not changed. Point callers at the tunnel URL yourself.`,
      ),
    );
  }
  console.log();
}

/**
 * Start a tunnel session. Exported separately from the command so tests
 * can drive the full lifecycle (write-back, restore, shutdown) without
 * process signals or `process.exit`.
 */
export async function startAgentTunnelSession(
  options: AgentTunnelOptions,
  hooks: AgentTunnelSessionHooks = {},
): Promise<AgentTunnelSession> {
  const localUrl = resolveLocalUrl(options);
  if (options.tunnelUrl) {
    try {
      new URL(options.tunnelUrl);
    } catch {
      fail(`--tunnel-url must be a valid URL, got "${options.tunnelUrl}"`);
    }
  }
  await resolveCredentials({ apiKey: options.apiKey });

  const service = new AgentsApiService();
  const agent = await resolveTargetAgent({
    service,
    agentFlag: options.agent,
    localUrl,
  });
  rememberAgentForDirectory(agent.id);

  const updateUrl = options.updateUrl !== false;

  // A crashed session leaves the agent pointing at a dead tunnel, with the
  // real URL still stashed under devTunnel. Restore it before provisioning:
  // if THIS session dies before its own write-back, the agent is left on the
  // real URL rather than on a dead tunnel.
  const staleStash = (
    agent.config as { devTunnel?: { previousUrl?: string } } | undefined
  )?.devTunnel;
  if (updateUrl && staleStash?.previousUrl) {
    try {
      const fresh = await service.get(agent.id);
      const restored = restoreDevTunnel({ config: fresh.config ?? {} });
      if (restored) {
        await service.update(agent.id, { config: restored });
        console.log(
          chalk.yellow(
            `Found a dev tunnel left behind by a previous session. Restored agent "${agent.name}" to ${staleStash.previousUrl} first.`,
          ),
        );
      }
    } catch {
      // Best-effort: the write-back below stashes the same previous URL, so a
      // failed early restore costs nothing.
    }
  }

  // A bring-your-own tunnel forwards straight to the user's own server, so
  // the local auth proxy would sit outside that chain and protect nothing.
  const useAuthProxy = options.auth !== false && !options.tunnelUrl;
  if (options.tunnelUrl && options.auth !== false) {
    console.log(
      chalk.gray(
        "Bring-your-own tunnel: the local auth proxy is not used. Your tunnel forwards directly to your server.",
      ),
    );
  }
  const secret = useAuthProxy
    ? crypto.randomBytes(24).toString("base64url")
    : undefined;

  let proxy: AuthProxy | undefined;
  if (useAuthProxy && secret) {
    proxy = await startAuthProxy({ targetUrl: localUrl, secret });
  }
  const tunnelTarget = proxy?.url ?? localUrl;

  let tunnel: TunnelHandle | undefined;
  let tunnelUrl: string;
  if (options.tunnelUrl) {
    tunnelUrl = options.tunnelUrl;
  } else {
    const spinner = createSpinner("Starting Cloudflare quick tunnel...").start();
    try {
      const started = await startQuickTunnel({ localUrl: tunnelTarget });
      tunnel = started.tunnel;
      tunnelUrl = started.url;
      spinner.succeed(`Tunnel ready at ${tunnelUrl}`);
    } catch (error) {
      failSpinner({ spinner, error, action: "start the tunnel" });
      await proxy?.close();
      process.exit(1);
    }
  }

  let previousUrl: string | undefined;
  let needsRestore = false;

  if (updateUrl) {
    const spinner = createSpinner(
      `Pointing agent "${agent.name}" at the tunnel...`,
    ).start();
    try {
      const fresh = await service.get(agent.id);
      const config = applyDevTunnel({
        config: fresh.config ?? {},
        tunnelUrl,
        secret,
      });
      previousUrl = (config.devTunnel as { previousUrl?: string }).previousUrl;
      await service.update(agent.id, { config });
      needsRestore = true;
      spinner.succeed(`Agent "${agent.name}" now points at the tunnel`);
    } catch (error) {
      failSpinner({ spinner, error, action: "update the agent URL" });
      tunnel?.stop();
      await proxy?.close();
      process.exit(1);
    }
  }

  printBanner({ tunnelUrl, localUrl, agent, previousUrl, updatedUrl: updateUrl });

  let resolveDone: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  // The tunnel the session currently runs over. Re-provisioning replaces it.
  let currentTunnel = tunnel;
  let currentTunnelUrl = tunnelUrl;
  let healthTimer: NodeJS.Timeout | undefined;

  const performShutdown = async (code: number): Promise<void> => {
    if (healthTimer) clearTimeout(healthTimer);

    if (needsRestore) {
      needsRestore = false;
      try {
        const fresh = await service.get(agent.id);
        const restored = restoreDevTunnel({ config: fresh.config ?? {} });
        if (restored) {
          await service.update(agent.id, { config: restored });
          console.log(
            `Restored agent "${agent.name}"${
              previousUrl ? ` to ${chalk.cyan(previousUrl)}` : ""
            }.`,
          );
        }
      } catch {
        // Do not suggest `agent update --config` here: it replaces the whole
        // config, so a url-only payload would wipe headers, auth and the
        // other fields. The UI edits the URL field alone.
        console.error(
          chalk.yellow(
            `Could not restore the agent URL automatically. Edit agent "${agent.name}" in the LangWatch UI and set its URL back${
              previousUrl ? ` to ${previousUrl}` : ""
            }.`,
          ),
        );
      }
    }

    currentTunnel?.stop();
    await proxy?.close();
    resolveDone(code);
  };

  // Idempotent: every caller of a second shutdown (a repeated signal, a tunnel
  // event racing a crash handler) shares the ONE in-flight restore instead of
  // starting another.
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (code = 0): Promise<void> =>
    (shutdownPromise ??= performShutdown(code));

  const attachTunnelEnd = (attached: TunnelHandle): void => {
    attached.once("exit", () => {
      if (shutdownPromise || attached !== currentTunnel) return;
      console.error(
        chalk.yellow("The tunnel process ended. Restoring the agent URL."),
      );
      void shutdown(0);
    });
    attached.once("error", (error) => {
      if (shutdownPromise || attached !== currentTunnel) return;
      console.error(
        chalk.yellow(
          `The tunnel reported an error (${error.message}). Restoring the agent URL.`,
        ),
      );
      void shutdown(1);
    });
  };
  if (currentTunnel) attachTunnelEnd(currentTunnel);

  // The health monitor: probe the local server THROUGH the public tunnel URL,
  // so the whole chain (edge, tunnel process, auth proxy, local server) is
  // covered. The auth proxy answers unauthenticated probes with 401, which
  // still proves the chain is up; Cloudflare's 530 or a transport failure
  // means the edge cannot reach the tunnel.
  const probeTunnel = async (): Promise<boolean> => {
    try {
      const response = await fetch(currentTunnelUrl, {
        method: "GET",
        signal: AbortSignal.timeout(
          hooks.healthProbeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS,
        ),
      });
      return response.status !== 530;
    } catch {
      return false;
    }
  };

  const refreshHeartbeat = async (): Promise<void> => {
    if (!needsRestore) return;
    try {
      const fresh = await service.get(agent.id);
      const touched = touchDevTunnel({ config: fresh.config ?? {} });
      if (touched) await service.update(agent.id, { config: touched });
    } catch {
      // Best-effort: a missed heartbeat is not worth ending the session over.
    }
  };

  const reprovisionTunnel = async (): Promise<void> => {
    console.error(
      chalk.yellow(
        "The tunnel stopped answering. Provisioning a replacement tunnel...",
      ),
    );
    const previous = currentTunnel;
    const started = await startQuickTunnel({ localUrl: tunnelTarget });
    currentTunnel = started.tunnel;
    currentTunnelUrl = started.url;
    attachTunnelEnd(started.tunnel);
    previous?.stop();
    if (needsRestore) {
      const fresh = await service.get(agent.id);
      const config = applyDevTunnel({
        config: fresh.config ?? {},
        tunnelUrl: currentTunnelUrl,
        secret,
      });
      await service.update(agent.id, { config });
    }
    console.error(chalk.green(`Tunnel replaced: ${currentTunnelUrl}`));
  };

  // A bring-your-own tunnel is not ours to replace, and with --no-update-url
  // the caller pointed things at the printed URL themselves, so a silent swap
  // would strand them. Both only get the warning.
  const canReprovision =
    updateUrl && !options.tunnelUrl && currentTunnel !== undefined;
  let consecutiveFailures = 0;

  const runHealthCheck = async (): Promise<void> => {
    if (await probeTunnel()) {
      consecutiveFailures = 0;
      await refreshHeartbeat();
      return;
    }
    consecutiveFailures++;
    if (consecutiveFailures < HEALTH_FAILURE_THRESHOLD) return;
    consecutiveFailures = 0;
    if (!canReprovision) {
      console.error(
        chalk.yellow(
          `The tunnel at ${currentTunnelUrl} stopped answering. This session cannot replace it. Restart your tunnel, or restart \`agent tunnel\`.`,
        ),
      );
      return;
    }
    try {
      await reprovisionTunnel();
    } catch (error) {
      console.error(
        chalk.red(
          `Could not provision a replacement tunnel: ${
            error instanceof Error ? error.message : String(error)
          }. Restoring the agent URL.`,
        ),
      );
      await shutdown(1);
    }
  };

  const healthIntervalMs = hooks.healthIntervalMs ?? HEALTH_INTERVAL_MS;
  const scheduleHealthCheck = (): void => {
    healthTimer = setTimeout(() => {
      if (shutdownPromise) return;
      void runHealthCheck().finally(() => {
        if (!shutdownPromise) scheduleHealthCheck();
      });
    }, healthIntervalMs);
    healthTimer.unref?.();
  };
  scheduleHealthCheck();

  return { done, shutdown };
}

/** The `agent tunnel` command action: run the session until a signal ends it. */
export const agentTunnelCommand = async (
  options: AgentTunnelOptions,
): Promise<void> => {
  const session = await startAgentTunnelSession(options);

  // A session is event-driven, and with `--tunnel-url` there is neither a
  // tunnel child process nor a local auth proxy to hold the event loop open —
  // the health monitor's timer is unref'd on purpose so it can never wedge a
  // shutdown. Without a ref'd handle the process ran out of work right after
  // printing the banner and exited, leaving the agent pointing at the caller's
  // tunnel with the real URL still stashed under devTunnel. Hold the loop for
  // exactly as long as the session runs.
  const keepAlive = setInterval(() => undefined, KEEP_ALIVE_INTERVAL_MS);

  let shutdownRequested = false;
  const onSignal = (): void => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      void session.shutdown(0);
      return;
    }
    // A repeated signal while the restore is in flight: give it a moment to
    // finish, then force-exit. Never a second restore; shutdown is idempotent.
    setTimeout(() => process.exit(130), FORCE_EXIT_GRACE_MS).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, onSignal);
  }

  const onCrash = (error: unknown): void => {
    console.error(
      chalk.red(
        `The dev session crashed: ${
          error instanceof Error ? error.message : String(error)
        }. Restoring the agent URL.`,
      ),
    );
    void session.shutdown(1);
  };
  process.once("uncaughtException", onCrash);
  process.once("unhandledRejection", onCrash);

  const code = await session.done;
  clearInterval(keepAlive);
  process.exit(code);
};
