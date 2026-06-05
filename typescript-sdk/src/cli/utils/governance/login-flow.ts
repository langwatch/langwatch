/**
 * Shared device-code login implementations. Two entry points:
 *
 *   1. `runUnifiedLoginFlow({ kind })` — the canonical flow used by
 *      `langwatch login` (interactive routes here for both modes). The
 *      same browser-approval ceremony works for either credential type;
 *      only the persist target differs:
 *        kind: 'device_session' → ~/.langwatch/config.json
 *        kind: 'project_api_key' → $CWD/.env (LANGWATCH_API_KEY)
 *      No copy-paste of the credential ever — the server ships it
 *      back to the CLI over the same RFC 8628 poll endpoint.
 *
 *   2. `runDeviceFlowLogin(...)` — back-compat wrapper that calls
 *      `runUnifiedLoginFlow({ kind: 'device_session' })`. Preserved so
 *      `commands/login.ts --device` and `utils/governance/wrapper.ts`
 *      auto-login keep working without churn.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  startDeviceCode,
  pollUntilDone,
  DeviceFlowError,
  type CredentialType,
  type ExchangeApiKeyResult,
  type ExchangeDeviceSessionResult,
} from "./device-flow";
import { loadConfig, saveConfig, type GovernanceConfig } from "./config";
import {
  askPersistChoice,
  buildExportBlock,
  detectShell,
  isShellAlreadyConfigured,
  persistBlockToRc,
  rcPath,
} from "./shell-rc";
import { formatLoginCeremony } from "./login-ceremony";
import { getCliBootstrap, type CliBootstrapResponse } from "./cli-api";

export interface RunUnifiedLoginOptions {
  /** Credential type to mint. Defaults to 'device_session' for back-compat. */
  kind?: CredentialType;
  /** Optional browser override (LANGWATCH_BROWSER also honoured). */
  browser?: string;
  /** Pre-loaded config to mutate; defaults to `loadConfig()`. */
  cfg?: GovernanceConfig;
}

export type RunDeviceFlowLoginOptions = Omit<RunUnifiedLoginOptions, "kind">;

/**
 * Run the canonical device-code login flow end-to-end. Selects what to
 * mint via `kind` (defaults to device_session); the same browser
 * approval ceremony covers both modes. On success, persists to the
 * right store + returns the latest GovernanceConfig.
 */
export async function runUnifiedLoginFlow(
  opts: RunUnifiedLoginOptions = {},
): Promise<GovernanceConfig> {
  const kind: CredentialType = opts.kind ?? "device_session";
  const cfg = opts.cfg ?? loadConfig();
  const baseUrl = cfg.control_plane_url;

  console.log(chalk.blue("🔐 LangWatch login"));
  console.log(chalk.gray(`Control plane: ${baseUrl}`));
  console.log(
    chalk.gray(
      kind === "project_api_key"
        ? "Mode: project SDK API key (will write .env)"
        : "Mode: device session (will write ~/.langwatch/config.json)",
    ),
  );

  const dc = await startDeviceCode({ baseUrl }, { credentialType: kind });
  const verifyURL =
    dc.verification_uri_complete ??
    `${dc.verification_uri.replace(/\/+$/, "")}?user_code=${encodeURIComponent(dc.user_code)}`;

  console.log();
  console.log(chalk.cyan(`Opening: ${verifyURL}`));
  console.log(
    chalk.gray(
      `If your browser doesn't open, paste the URL above and enter code: ${chalk.bold(dc.user_code)}`,
    ),
  );
  console.log();

  await openInBrowser(verifyURL, opts.browser);

  const spinner = ora("Waiting for you to approve in the browser").start();
  try {
    const result = await pollUntilDone({ baseUrl }, dc);
    if (result.kind === "device_session") {
      spinner.succeed(`Logged in as ${result.user.email}`);
      persistDeviceSession(cfg, result);
      saveConfig(cfg);

      const bootstrap = await fetchBootstrapSafely(cfg);

      // Pick up the server's authoritative gateway URL. Without this,
      // self-hosted CLI users would see the SaaS default
      // (https://gateway.langwatch.com) on whoami / login output even
      // though the actual gateway is on localhost:5563. The server's
      // `gatewayUrl` reflects `LW_GATEWAY_BASE_URL` or the IS_SAAS-
      // aware fallback. Backwards-compatible: older servers (without
      // this field) leave the local default in place.
      if (bootstrap?.gatewayUrl) {
        cfg.gateway_url = bootstrap.gatewayUrl;
        saveConfig(cfg);
      }

      // Cache the org's per-tool path policy so the `langwatch <tool>`
      // wrapper gates path selection on the admin's choices offline.
      // Older servers omit the field — the wrapper then falls back to
      // the hardcoded defaults.
      if (bootstrap?.toolPolicies) {
        cfg.tool_policies = bootstrap.toolPolicies;
        saveConfig(cfg);
      }

      console.log();
      const ceremonyLines = formatLoginCeremony({
        email: cfg.user?.email ?? result.user.email,
        organizationName: cfg.organization?.name,
        providers: bootstrap?.providers,
        budget:
          bootstrap?.budget?.monthlyLimitUsd != null
            ? {
                period: bootstrap.budget.period,
                limitUsd: bootstrap.budget.monthlyLimitUsd,
                usedUsd: bootstrap.budget.monthlyUsedUsd,
              }
            : undefined,
      });
      for (const line of ceremonyLines) {
        console.log(line);
      }
      console.log();
      console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));

      return cfg;
    }

    // kind === 'api_key' — write to project-local .env (NO copy-paste)
    spinner.succeed(
      `API key generated for project ${chalk.bold(result.project.name)}`,
    );
    const envResult = writeApiKeyToEnv(result.api_key);
    console.log();
    console.log(chalk.green("✓ API key saved to .env"));
    if (envResult.created) {
      console.log(chalk.gray(`  • Created .env file at ${envResult.path}`));
    } else if (envResult.updated) {
      console.log(chalk.gray(`  • Updated existing API key in ${envResult.path}`));
    } else {
      console.log(chalk.gray(`  • Added API key to ${envResult.path}`));
    }
    console.log();
    console.log(
      chalk.gray(
        `  Project: ${result.project.name} (${result.project.slug})`,
      ),
    );
    console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));
    return cfg;
  } catch (err) {
    spinner.fail();
    if (err instanceof DeviceFlowError) {
      switch (err.kind) {
        case "denied":
          throw new Error(
            "authorization denied — you can retry `langwatch login`",
          );
        case "expired":
          throw new Error(
            "authorization request expired — run `langwatch login` again",
          );
        default:
          throw err;
      }
    }
    throw err;
  }
}

/**
 * Back-compat wrapper. New callers should use `runUnifiedLoginFlow`
 * directly with an explicit `kind`.
 */
export async function runDeviceFlowLogin(
  opts: RunDeviceFlowLoginOptions = {},
): Promise<GovernanceConfig> {
  return runUnifiedLoginFlow({ ...opts, kind: "device_session" });
}

function persistDeviceSession(
  cfg: GovernanceConfig,
  result: ExchangeDeviceSessionResult,
): void {
  cfg.access_token = result.access_token;
  cfg.refresh_token = result.refresh_token;
  cfg.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
  cfg.user = {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
  };
  cfg.organization = {
    id: result.organization.id,
    slug: result.organization.slug,
    name: result.organization.name,
  };
  if (result.default_personal_vk) {
    cfg.default_personal_vk = {
      id: result.default_personal_vk.id,
      secret: result.default_personal_vk.secret,
      prefix: result.default_personal_vk.prefix,
    };
  }
  if (result.endpoint) {
    cfg.control_plane_url = result.endpoint.replace(/\/+$/, "");
  }
}

interface EnvWriteResult {
  created: boolean;
  updated: boolean;
  path: string;
}

function writeApiKeyToEnv(apiKey: string): EnvWriteResult {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `LANGWATCH_API_KEY=${apiKey}\n`);
    return { created: true, updated: false, path: envPath };
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");
  let found = false;
  const updatedLines = lines.map((line) => {
    if (line.startsWith("LANGWATCH_API_KEY=")) {
      found = true;
      return `LANGWATCH_API_KEY=${apiKey}`;
    }
    return line;
  });
  if (!found) {
    if (content.endsWith("\n") || content === "") {
      updatedLines.push(`LANGWATCH_API_KEY=${apiKey}`);
    } else {
      updatedLines.push("", `LANGWATCH_API_KEY=${apiKey}`);
    }
  }
  fs.writeFileSync(envPath, updatedLines.join("\n"));
  return { created: false, updated: found, path: envPath };
}

async function fetchBootstrapSafely(
  cfg: GovernanceConfig,
): Promise<CliBootstrapResponse | null> {
  try {
    return await getCliBootstrap(cfg);
  } catch {
    return null;
  }
}

async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice =
    override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  const open = (await import("open")).default;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    await open(url, { app: { name: choice } });
  } catch {
    // browser failure shouldn't break login — user can paste manually
  }
}

/**
 * Bug-bash item 1.2 + 1.3 — post-login, OFFER to persist the union
 * export block to the user's shell rc. Stays quiet when:
 *   - the user already picked "never" (shell_rc_preference=skip)
 *   - the current shell already has the gateway env exported
 *     (process.env.ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN present)
 *   - stdin is not a TTY (CI / scripted callers)
 *   - the shell isn't one we can write to (cmd / powershell stay
 *     on the eval'd `langwatch init-shell` flow)
 *
 * The prompt is Y / n / never. "n" doesn't persist — the next
 * login on an unconfigured shell re-asks. "never" sets
 * shell_rc_preference=skip so we stay quiet on this machine.
 */
async function maybeOfferShellRcPersist(
  cfg: GovernanceConfig,
): Promise<void> {
  if (cfg.shell_rc_preference === "skip") return;
  if (isShellAlreadyConfigured()) return;
  const shell = detectShell();
  if (!shell) return;
  if (!cfg.default_personal_vk?.secret) return;

  const target = rcPath(shell);
  const block = buildExportBlock(cfg, shell);
  if (!block.trim()) return;

  console.log();
  console.log(
    chalk.gray(
      "  langwatch can persist these exports so any new shell picks them up.",
    ),
  );
  const choice = await askPersistChoice(target);
  if (choice === "skip" || choice === "no") return;
  if (choice === "never") {
    cfg.shell_rc_preference = "skip";
    try {
      saveConfig(cfg);
    } catch {
      // best effort
    }
    return;
  }
  // "yes"
  try {
    const wrote = persistBlockToRc(shell, block);
    console.log(chalk.green(`  ✓ Wrote langwatch export block to ${wrote}`));
    console.log(
      chalk.gray(`  Open a new shell or run \`source ${wrote}\` to load it.`),
    );
  } catch (err) {
    console.log(
      chalk.yellow(
        `  ! Couldn't write to ${target}: ${(err as Error).message}`,
      ),
    );
  }
}

// Type-only re-exports so callers can import the shapes from this
// module without reaching into device-flow.ts.
export type { ExchangeApiKeyResult, ExchangeDeviceSessionResult };
