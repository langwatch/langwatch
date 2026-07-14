/**
 * `langwatch config <get|set|list>` — explicit persistence + introspection
 * for user-global CLI configuration. Mirrors `gh config`, `doctl auth init`,
 * and `stripe config` patterns. Replaces hand-editing
 * `~/.langwatch/config.json` for the common case (set the endpoint).
 *
 * Today's keys (whitelisted — no arbitrary key/value writes):
 *   - endpoint        → control_plane_url
 *   - gateway-url     → gateway_url
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import chalk from "chalk";
import { loadConfig, saveConfig, configPath } from "@/cli/utils/governance/config";
import { resolveControlPlaneEndpoint } from "@/cli/utils/governance/resolveEndpoint";

type ConfigKey = "endpoint" | "gateway-url";

const KEY_LABELS: Record<ConfigKey, string> = {
  endpoint: "endpoint",
  "gateway-url": "gateway_url",
};

const VALID_KEYS = new Set<ConfigKey>(["endpoint", "gateway-url"]);

function isValidKey(s: string): s is ConfigKey {
  return VALID_KEYS.has(s as ConfigKey);
}

function validateUrl(url: string): string | null {
  if (!url || url.trim() === "") return "value cannot be empty";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "value must be an absolute URL with http(s) scheme";
    }
  } catch {
    return "value must be an absolute URL with http(s) scheme";
  }
  return null;
}

export const configSetCommand = async (
  key: string,
  value: string,
): Promise<void> => {
  if (!isValidKey(key)) {
    console.error(
      chalk.red(
        `Error: unknown config key "${key}". Supported: ${Array.from(VALID_KEYS).join(", ")}`,
      ),
    );
    process.exit(1);
  }
  const err = validateUrl(value);
  if (err) {
    console.error(chalk.red(`Error: ${err}`));
    process.exit(1);
  }

  const trimmed = value.replace(/\/+$/, "");
  const cfg = loadConfig();
  if (key === "endpoint") {
    cfg.control_plane_url = trimmed;
  } else if (key === "gateway-url") {
    cfg.gateway_url = trimmed;
  }
  saveConfig(cfg);

  console.log(chalk.green(`✓ ${key} = ${trimmed}`));
  console.log(chalk.gray(`  saved to ${configPath()}`));
};

export const configGetCommand = async (key: string): Promise<void> => {
  if (!isValidKey(key)) {
    console.error(
      chalk.red(
        `Error: unknown config key "${key}". Supported: ${Array.from(VALID_KEYS).join(", ")}`,
      ),
    );
    process.exit(1);
  }
  const cfg = loadConfig();
  if (key === "endpoint") {
    // Use the unified resolver so the printed value matches what every
    // other command sees (env > config > default).
    const resolved = resolveControlPlaneEndpoint({ cfg });
    process.stdout.write(`${resolved.url}\n`);
  } else if (key === "gateway-url") {
    process.stdout.write(`${cfg.gateway_url}\n`);
  }
};

export const configListCommand = async (): Promise<void> => {
  const cfg = loadConfig();
  const endpoint = resolveControlPlaneEndpoint({ cfg });

  const sourceLabel: Record<typeof endpoint.source, string> = {
    flag: "(--endpoint flag)",
    env: "(LANGWATCH_ENDPOINT env)",
    config: "(persisted config)",
    default: "(built-in default)",
  };

  console.log(`endpoint    = ${endpoint.url}  ${chalk.gray(sourceLabel[endpoint.source])}`);
  console.log(`gateway-url = ${cfg.gateway_url}`);
  console.log();
  console.log(chalk.gray(`config file: ${configPath()}`));
  // Intentional: never print access_token, refresh_token, or VK secret.
  // Use `langwatch whoami` for session introspection (which also avoids
  // printing secrets).
  if (cfg.access_token) {
    console.log(chalk.gray("device session: present (use `langwatch whoami` to inspect)"));
  }
};
