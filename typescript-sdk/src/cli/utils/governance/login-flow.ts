/**
 * Shared device-flow (RFC 8628) login implementation. Used by both:
 *   - `langwatch login --device` (commands/login.ts) — explicit user flow
 *   - `langwatch claude` / `codex` / etc. (utils/governance/wrapper.ts) —
 *     auto-triggered when the wrapper finds no usable config and stdin is
 *     a TTY (or LANGWATCH_AUTO_LOGIN=1 is set).
 *
 * Both call sites need the same end-state: a persisted GovernanceConfig
 * with access_token + refresh_token + user/org/personal-VK ready for the
 * wrapper to consume on next invocation.
 */

import chalk from "chalk";
import ora from "ora";
import {
  startDeviceCode,
  pollUntilDone,
  DeviceFlowError,
} from "./device-flow";
import { loadConfig, saveConfig, type GovernanceConfig } from "./config";
import { formatLoginCeremony } from "./login-ceremony";
import { getCliBootstrap, type CliBootstrapResponse } from "./cli-api";

export interface RunDeviceFlowLoginOptions {
  /** Optional browser override (LANGWATCH_BROWSER also honoured). */
  browser?: string;
  /** Pre-loaded config to mutate; defaults to `loadConfig()`. */
  cfg?: GovernanceConfig;
}

/**
 * Run the device-code OAuth flow end-to-end and persist the resulting
 * access_token + refresh_token + user/org/personal-VK to the
 * GovernanceConfig file.
 *
 * Side-effects:
 *   - prints status to stdout (header, verification URL, fallback code)
 *   - opens the verification URL in the user's browser (unless
 *     LANGWATCH_BROWSER=none or `browser==='none'`)
 *   - blocks until the user approves in the browser, or throws on
 *     denial/expiry/network failure
 *   - writes the final config via saveConfig
 *
 * @returns the persisted config (so callers can use it without a second
 *   `loadConfig()` round-trip)
 */
export async function runDeviceFlowLogin(
  opts: RunDeviceFlowLoginOptions = {},
): Promise<GovernanceConfig> {
  const cfg = opts.cfg ?? loadConfig();
  const baseUrl = cfg.control_plane_url;

  console.log(chalk.blue("🔐 LangWatch governance login"));
  console.log(chalk.gray(`Control plane: ${baseUrl}`));

  const dc = await startDeviceCode({ baseUrl });
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

  const spinner = ora("Waiting for you to log in").start();
  try {
    const result = await pollUntilDone({ baseUrl }, dc);
    spinner.succeed(`Logged in as ${result.user.email}`);

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
    saveConfig(cfg);

    const bootstrap = await fetchBootstrapSafely(cfg);
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
    console.log(chalk.gray(`  Gateway:   ${cfg.gateway_url}`));
    console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));
    return cfg;
  } catch (err) {
    spinner.fail();
    if (err instanceof DeviceFlowError) {
      switch (err.kind) {
        case "denied":
          throw new Error(
            "authorization denied — you can retry `langwatch login --device`",
          );
        case "expired":
          throw new Error(
            "authorization request expired — run `langwatch login --device` again",
          );
        default:
          throw err;
      }
    }
    throw err;
  }
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
