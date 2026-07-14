import chalk from "chalk";
import * as fs from "node:fs";
import * as os from "node:os";

import { mintIngestionKey } from "@/cli/utils/governance/cli-api";
import {
  buildCopilotAppEnv,
  findCopilotApp,
  type AppPlatform,
  type LaunchAgentSpec,
} from "@/cli/utils/governance/copilot-app";
import { installCopilotAppAgent } from "@/cli/utils/governance/copilot-app-agent";
import {
  isLoggedIn,
  loadConfig,
  type GovernanceConfig,
} from "@/cli/utils/governance/config";

/**
 * `langwatch copilot-app connect` — provisions capture for the standalone
 * GitHub Copilot app (ADR-039 §Extension). The app is a long-running GUI,
 * not a per-invocation CLI, so it is connected once rather than wrapped:
 * mint a personal ingest key of sourceType "copilot_app", then install a
 * login agent that owns the app's launch and injects the direct-OTLP env.
 * Re-running rotates the key (server-side hard-cut) and re-points the
 * agent; `langwatch logout` tears it down.
 */

const SOURCE_TYPE = "copilot_app";

export type ConnectFailure = "not-logged-in" | "not-installed" | "unsupported-os";

export class CopilotAppConnectError extends Error {
  constructor(
    readonly kind: ConnectFailure,
    message: string,
  ) {
    super(message);
    this.name = "CopilotAppConnectError";
  }
}

export interface ConnectCopilotAppDeps {
  platform: AppPlatform;
  home: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
  loadConfig: () => GovernanceConfig;
  mint: (
    cfg: GovernanceConfig,
    sourceType: string,
  ) => Promise<{ token: string; endpoint: string }>;
  install: (spec: LaunchAgentSpec) => string;
  captureContent: boolean;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface ConnectCopilotAppResult {
  sourceType: typeof SOURCE_TYPE;
  endpoint: string;
  agentPath: string;
  captureContent: boolean;
}

/**
 * Orchestrates the connect flow with injected collaborators so the
 * behaviour (guards, ordering, notices) is unit-testable without touching
 * the machine, the network, or the OS service manager. Ordering matters:
 * the app-installed guard fires BEFORE the mint, so a missing app never
 * mints a stray key.
 */
export async function connectCopilotApp(
  deps: ConnectCopilotAppDeps,
): Promise<ConnectCopilotAppResult> {
  const cfg = deps.loadConfig();
  if (!isLoggedIn(cfg)) {
    throw new CopilotAppConnectError(
      "not-logged-in",
      "Not logged in. Run `langwatch login --device` first.",
    );
  }

  const execPath = findCopilotApp(
    deps.platform,
    deps.home,
    deps.exists,
    deps.env,
  );
  if (!execPath) {
    throw new CopilotAppConnectError(
      "not-installed",
      "GitHub Copilot app not found. Install it from https://github.com/features/copilot before connecting.",
    );
  }

  const { token, endpoint } = await deps.mint(cfg, SOURCE_TYPE);

  const appEnv = buildCopilotAppEnv({
    endpoint,
    token,
    captureContent: deps.captureContent,
  });
  const agentPath = deps.install({
    platform: deps.platform,
    home: deps.home,
    execPath,
    env: appEnv,
  });

  if (!deps.captureContent) {
    deps.warn(
      "[langwatch] content capture is off for the Copilot app; traces will carry tokens only.",
    );
  }
  const project =
    cfg.organization?.slug ?? cfg.organization?.name ?? "your personal project";
  deps.info(
    `GitHub Copilot app connected. Usage will be tracked into ${project}. Restart the app to begin capture.`,
  );

  return {
    sourceType: SOURCE_TYPE,
    endpoint,
    agentPath,
    captureContent: deps.captureContent,
  };
}

function currentPlatform(): AppPlatform {
  const p = os.platform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  throw new CopilotAppConnectError(
    "unsupported-os",
    `The Copilot app capture agent is not supported on ${p}.`,
  );
}

/** CLI entry point — wires the real collaborators. */
export const copilotAppConnectCommand = async (options?: {
  tokensOnly?: boolean;
}): Promise<void> => {
  try {
    const result = await connectCopilotApp({
      platform: currentPlatform(),
      home: os.homedir(),
      env: process.env,
      exists: (p) => fs.existsSync(p),
      loadConfig,
      mint: mintIngestionKey,
      install: installCopilotAppAgent,
      captureContent: !options?.tokensOnly,
      info: (msg) => console.log(chalk.green(msg)),
      warn: (msg) => console.warn(chalk.yellow(msg)),
    });
    void result;
  } catch (error) {
    if (error instanceof CopilotAppConnectError) {
      console.error(chalk.yellow(error.message));
      process.exit(1);
    }
    throw error;
  }
};
