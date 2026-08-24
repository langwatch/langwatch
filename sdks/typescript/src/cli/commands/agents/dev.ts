/**
 * `langwatch agent dev` (alias `agent tunnel`): expose a local agent server
 * through a public tunnel and repoint a registered HTTP agent at it, so
 * platform scenarios run against the local process. Ctrl-C restores the
 * previous URL.
 *
 * The session phases live in `./dev/`: input resolution, the local auth
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
import { type AuthProxy, startAuthProxy } from "./dev/auth-proxy";
import { startQuickTunnel, type TunnelHandle } from "./dev/quick-tunnel";
import {
  fail,
  rememberAgentForDirectory,
  resolveLocalUrl,
  resolveTargetAgent,
} from "./dev/resolve";
import {
  applyDevTunnel,
  deriveSimulationsUrl,
  restoreDevTunnel,
} from "./dev/write-back";

export interface AgentDevOptions {
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

export interface AgentDevSession {
  /** Resolves with the exit code once shutdown finishes. */
  done: Promise<number>;
  shutdown: (code?: number) => Promise<void>;
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
 * Start a dev tunnel session. Exported separately from the command so tests
 * can drive the full lifecycle (write-back, restore, shutdown) without
 * process signals or `process.exit`.
 */
export async function startAgentDevSession(
  options: AgentDevOptions,
): Promise<AgentDevSession> {
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

  const updateUrl = options.updateUrl !== false;
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

  let shuttingDown = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

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

    tunnel?.stop();
    await proxy?.close();
    resolveDone(code);
  };

  tunnel?.once("exit", () => {
    if (shuttingDown) return;
    console.error(
      chalk.yellow("The tunnel process ended. Restoring the agent URL."),
    );
    void shutdown(0);
  });

  return { done, shutdown };
}

/** The `agent dev` command action: run the session until a signal ends it. */
export const agentDevCommand = async (
  options: AgentDevOptions,
): Promise<void> => {
  const session = await startAgentDevSession(options);

  process.once("SIGINT", () => void session.shutdown(0));
  process.once("SIGTERM", () => void session.shutdown(0));

  const code = await session.done;
  process.exit(code);
};
