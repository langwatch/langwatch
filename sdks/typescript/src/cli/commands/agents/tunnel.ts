/**
 * `langwatch agent tunnel` (hidden alias `agent dev`): expose a local agent
 * through a public tunnel and repoint a registered HTTP agent at it. Ctrl-C
 * restores the previous URL. Session phases live in `./tunnel/`.
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
 * How long one probe may take. A half-open socket is exactly the failure
 * being monitored for, and also the case where `fetch` never settles.
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

type TunnelAgent = Awaited<ReturnType<typeof resolveTargetAgent>>;

/**
 * A crashed session leaves the agent pointing at a dead tunnel, with the real
 * URL still stashed under devTunnel. Restore it before provisioning, so a
 * session that dies before its own write-back leaves the agent on the real URL.
 */
async function restoreStaleStash({
  service,
  agent,
}: {
  service: AgentsApiService;
  agent: TunnelAgent;
}): Promise<void> {
  const staleStash = (agent.config as { devTunnel?: { previousUrl?: string } } | undefined)
    ?.devTunnel;
  if (!staleStash?.previousUrl) return;
  try {
    const fresh = await service.get(agent.id);
    const restored = restoreDevTunnel({ config: fresh.config ?? {} });
    if (!restored) return;
    await service.update(agent.id, { config: restored });
    console.log(
      chalk.yellow(
        `Found a dev tunnel left behind by a previous session. Restored agent "${agent.name}" to ${staleStash.previousUrl} first.`,
      ),
    );
  } catch {
    // Best-effort: the write-back below stashes the same previous URL, so a
    // failed early restore costs nothing.
    void 0;
  }
}

/**
 * A bring-your-own tunnel forwards straight to the user's own server, so the
 * local auth proxy would sit outside that chain and protect nothing.
 */
async function startProxyIfUsed({
  options,
  localUrl,
}: {
  options: AgentTunnelOptions;
  localUrl: string;
}): Promise<{ proxy: AuthProxy | undefined; secret: string | undefined }> {
  const useAuthProxy = options.auth !== false && !options.tunnelUrl;
  if (options.tunnelUrl && options.auth !== false) {
    console.log(
      chalk.gray(
        "Bring-your-own tunnel: the local auth proxy is not used. Your tunnel forwards directly to your server.",
      ),
    );
  }
  if (!useAuthProxy) return { proxy: undefined, secret: undefined };
  const secret = crypto.randomBytes(24).toString("base64url");
  return { proxy: await startAuthProxy({ targetUrl: localUrl, secret }), secret };
}

async function openTunnel({
  options,
  tunnelTarget,
  proxy,
}: {
  options: AgentTunnelOptions;
  tunnelTarget: string;
  proxy: AuthProxy | undefined;
}): Promise<{ tunnel: TunnelHandle | undefined; tunnelUrl: string }> {
  if (options.tunnelUrl) return { tunnel: undefined, tunnelUrl: options.tunnelUrl };
  const spinner = createSpinner("Starting Cloudflare quick tunnel...").start();
  try {
    const started = await startQuickTunnel({ localUrl: tunnelTarget });
    spinner.succeed(`Tunnel ready at ${started.url}`);
    return { tunnel: started.tunnel, tunnelUrl: started.url };
  } catch (error) {
    failSpinner({ spinner, error, action: "start the tunnel" });
    await proxy?.close();
    process.exit(1);
  }
}

/** Writes the tunnel into the agent's config; answers the URL it stashed. */
async function pointAgentAtTunnel({
  service,
  agent,
  tunnelUrl,
  secret,
  tunnel,
  proxy,
}: {
  service: AgentsApiService;
  agent: TunnelAgent;
  tunnelUrl: string;
  secret: string | undefined;
  tunnel: TunnelHandle | undefined;
  proxy: AuthProxy | undefined;
}): Promise<string | undefined> {
  const spinner = createSpinner(`Pointing agent "${agent.name}" at the tunnel...`).start();
  try {
    const fresh = await service.get(agent.id);
    const config = applyDevTunnel({ config: fresh.config ?? {}, tunnelUrl, secret });
    const previousUrl = (config.devTunnel as { previousUrl?: string }).previousUrl;
    await service.update(agent.id, { config });
    spinner.succeed(`Agent "${agent.name}" now points at the tunnel`);
    return previousUrl;
  } catch (error) {
    failSpinner({ spinner, error, action: "update the agent URL" });
    tunnel?.stop();
    await proxy?.close();
    process.exit(1);
  }
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
  const agent = await resolveTargetAgent({ service, agentFlag: options.agent, localUrl });
  rememberAgentForDirectory(agent.id);

  const updateUrl = options.updateUrl !== false;
  if (updateUrl) await restoreStaleStash({ service, agent });

  const { proxy, secret } = await startProxyIfUsed({ options, localUrl });
  const tunnelTarget = proxy?.url ?? localUrl;
  const { tunnel, tunnelUrl } = await openTunnel({ options, tunnelTarget, proxy });

  const previousUrl = updateUrl
    ? await pointAgentAtTunnel({ service, agent, tunnelUrl, secret, tunnel, proxy })
    : undefined;

  printBanner({ tunnelUrl, localUrl, agent, previousUrl, updatedUrl: updateUrl });

  const session = new TunnelSession({
    service,
    agent,
    proxy,
    secret,
    tunnelTarget,
    tunnel,
    tunnelUrl,
    previousUrl,
    needsRestore: updateUrl,
    // A bring-your-own tunnel is not ours to replace, and with --no-update-url
    // the caller pointed things at the printed URL themselves, so a silent swap
    // would strand them. Both only get the warning.
    canReprovision: updateUrl && !options.tunnelUrl && tunnel !== undefined,
    hooks,
  });
  session.start();
  return { done: session.done, shutdown: (code) => session.shutdown(code) };
}

/** A running tunnel: its restore, its health monitor and its replacement. */
class TunnelSession {
  readonly done: Promise<number>;
  private resolveDone: (code: number) => void = () => undefined;
  private readonly service: AgentsApiService;
  private readonly agent: TunnelAgent;
  private readonly proxy: AuthProxy | undefined;
  private readonly secret: string | undefined;
  private readonly tunnelTarget: string;
  private readonly previousUrl: string | undefined;
  private readonly canReprovision: boolean;
  private readonly hooks: AgentTunnelSessionHooks;
  /** The tunnel the session currently runs over. Re-provisioning replaces it. */
  private currentTunnel: TunnelHandle | undefined;
  private currentTunnelUrl: string;
  private needsRestore: boolean;
  private healthTimer: NodeJS.Timeout | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private consecutiveFailures = 0;

  constructor(input: {
    service: AgentsApiService;
    agent: TunnelAgent;
    proxy: AuthProxy | undefined;
    secret: string | undefined;
    tunnelTarget: string;
    tunnel: TunnelHandle | undefined;
    tunnelUrl: string;
    previousUrl: string | undefined;
    needsRestore: boolean;
    canReprovision: boolean;
    hooks: AgentTunnelSessionHooks;
  }) {
    this.service = input.service;
    this.agent = input.agent;
    this.proxy = input.proxy;
    this.secret = input.secret;
    this.tunnelTarget = input.tunnelTarget;
    this.currentTunnel = input.tunnel;
    this.currentTunnelUrl = input.tunnelUrl;
    this.previousUrl = input.previousUrl;
    this.needsRestore = input.needsRestore;
    this.canReprovision = input.canReprovision;
    this.hooks = input.hooks;
    this.done = new Promise<number>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  start(): void {
    if (this.currentTunnel) this.attachTunnelEnd(this.currentTunnel);
    this.scheduleHealthCheck();
  }

  /**
   * Idempotent: every caller of a second shutdown (a repeated signal, a tunnel
   * event racing a crash handler) shares the ONE in-flight restore.
   */
  shutdown(code = 0): Promise<void> {
    return (this.shutdownPromise ??= this.performShutdown(code));
  }

  private async performShutdown(code: number): Promise<void> {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    if (this.needsRestore) {
      this.needsRestore = false;
      await this.restoreAgentUrl();
    }
    this.currentTunnel?.stop();
    await this.proxy?.close();
    this.resolveDone(code);
  }

  private async restoreAgentUrl(): Promise<void> {
    const { agent, previousUrl } = this;
    try {
      const fresh = await this.service.get(agent.id);
      const restored = restoreDevTunnel({ config: fresh.config ?? {} });
      if (!restored) return;
      await this.service.update(agent.id, { config: restored });
      console.log(
        `Restored agent "${agent.name}"${previousUrl ? ` to ${chalk.cyan(previousUrl)}` : ""}.`,
      );
    } catch {
      // Do not suggest `agent update --config` here: it replaces the whole
      // config, so a url-only payload would wipe headers, auth and the rest.
      console.error(
        chalk.yellow(
          `Could not restore the agent URL automatically. Edit agent "${agent.name}" in the LangWatch UI and set its URL back${
            previousUrl ? ` to ${previousUrl}` : ""
          }.`,
        ),
      );
    }
  }

  private attachTunnelEnd(attached: TunnelHandle): void {
    attached.once("exit", () => {
      if (this.shutdownPromise || attached !== this.currentTunnel) return;
      console.error(chalk.yellow("The tunnel process ended. Restoring the agent URL."));
      void this.shutdown(0);
    });
    attached.once("error", (error) => {
      if (this.shutdownPromise || attached !== this.currentTunnel) return;
      console.error(
        chalk.yellow(`The tunnel reported an error (${error.message}). Restoring the agent URL.`),
      );
      void this.shutdown(1);
    });
  }

  /**
   * Probes the local server THROUGH the public tunnel URL, so the whole chain
   * is covered. The auth proxy's 401 still proves the chain is up; a 530 or a
   * transport failure means the edge cannot reach the tunnel.
   */
  private async probeTunnel(): Promise<boolean> {
    try {
      const response = await fetch(this.currentTunnelUrl, {
        method: "GET",
        signal: AbortSignal.timeout(this.hooks.healthProbeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS),
      });
      return response.status !== 530;
    } catch {
      return false;
    }
  }

  private async refreshHeartbeat(): Promise<void> {
    if (!this.needsRestore) return;
    try {
      const fresh = await this.service.get(this.agent.id);
      const touched = touchDevTunnel({ config: fresh.config ?? {} });
      if (touched) await this.service.update(this.agent.id, { config: touched });
    } catch {
      // Best-effort: a missed heartbeat is not worth ending the session over.
      void 0;
    }
  }

  private async reprovisionTunnel(): Promise<void> {
    console.error(
      chalk.yellow("The tunnel stopped answering. Provisioning a replacement tunnel..."),
    );
    const previous = this.currentTunnel;
    const started = await startQuickTunnel({ localUrl: this.tunnelTarget });
    this.currentTunnel = started.tunnel;
    this.currentTunnelUrl = started.url;
    this.attachTunnelEnd(started.tunnel);
    previous?.stop();
    if (this.needsRestore) {
      const fresh = await this.service.get(this.agent.id);
      const config = applyDevTunnel({
        config: fresh.config ?? {},
        tunnelUrl: this.currentTunnelUrl,
        secret: this.secret,
      });
      await this.service.update(this.agent.id, { config });
    }
    console.error(chalk.green(`Tunnel replaced: ${this.currentTunnelUrl}`));
  }

  private async runHealthCheck(): Promise<void> {
    if (await this.probeTunnel()) {
      this.consecutiveFailures = 0;
      await this.refreshHeartbeat();
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures < HEALTH_FAILURE_THRESHOLD) return;
    this.consecutiveFailures = 0;
    if (!this.canReprovision) {
      console.error(
        chalk.yellow(
          `The tunnel at ${this.currentTunnelUrl} stopped answering. This session cannot replace it. Restart your tunnel, or restart \`agent tunnel\`.`,
        ),
      );
      return;
    }
    try {
      await this.reprovisionTunnel();
    } catch (error) {
      console.error(
        chalk.red(
          `Could not provision a replacement tunnel: ${
            error instanceof Error ? error.message : String(error)
          }. Restoring the agent URL.`,
        ),
      );
      await this.shutdown(1);
    }
  }

  private scheduleHealthCheck(): void {
    this.healthTimer = setTimeout(() => {
      if (this.shutdownPromise) return;
      void this.runHealthCheck().finally(() => {
        if (!this.shutdownPromise) this.scheduleHealthCheck();
      });
    }, this.hooks.healthIntervalMs ?? HEALTH_INTERVAL_MS);
    this.healthTimer.unref?.();
  }
}

/** The `agent tunnel` command action: run the session until a signal ends it. */
export const agentTunnelCommand = async (options: AgentTunnelOptions): Promise<void> => {
  const session = await startAgentTunnelSession(options);

  // With `--tunnel-url` there is no tunnel child process or auth proxy to
  // hold the event loop open (the health monitor's timer is unref'd), so a
  // ref'd keep-alive holds it for exactly as long as the session runs.
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
