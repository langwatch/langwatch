/**
 * Persists langwatch CLI governance credentials at
 * ~/.langwatch/config.json. The file is mode 0600 (atomic rename
 * on save). The shape mirrors what `POST /api/auth/cli/exchange`
 * returns plus a few client-side fields.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GovernanceConfig {
  /** AI Gateway base URL (e.g. https://gateway.langwatch.ai). */
  gateway_url: string;
  /** Control plane base URL (e.g. https://app.langwatch.ai). */
  control_plane_url: string;

  /** Short-lived bearer for the gateway. */
  access_token?: string;
  /** Long-lived token for refreshing access_token. */
  refresh_token?: string;
  /** Unix epoch (seconds) when access_token expires. */
  expires_at?: number;

  user?: { id?: string; email?: string; name?: string };
  organization?: { id?: string; slug?: string; name?: string };
  default_personal_vk?: { id?: string; secret?: string; prefix?: string };

  /**
   * Most-recent signed `request_increase_url` returned by the
   * gateway in a 402 budget_exceeded payload — cached so
   * `langwatch request-increase` opens the exact URL the gateway
   * produced (with HMAC'd user/limit/spent params).
   */
  last_request_increase_url?: string;
}

function defaults(): GovernanceConfig {
  const cp = process.env.LANGWATCH_ENDPOINT ?? process.env.LANGWATCH_URL ?? "https://app.langwatch.ai";
  const gw = process.env.LANGWATCH_GATEWAY_URL ?? "https://gateway.langwatch.ai";
  return { gateway_url: gw, control_plane_url: cp };
}

/**
 * Returns the absolute path to the config file. Override with
 * LANGWATCH_CLI_CONFIG for tests / non-default homes.
 */
export function configPath(): string {
  const env = process.env.LANGWATCH_CLI_CONFIG;
  if (env) return env;
  return path.join(os.homedir(), ".langwatch", "config.json");
}

/** Read the config from disk, merging in defaults for missing keys. */
export function loadConfig(): GovernanceConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return defaults();
  try {
    const text = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(text) as Partial<GovernanceConfig>;
    return { ...defaults(), ...parsed };
  } catch (err) {
    throw new Error(`Failed to parse ${p}: ${(err as Error).message}`);
  }
}

/** Write the config atomically (tmp file + rename) with mode 0600. */
export function saveConfig(cfg: GovernanceConfig): void {
  const p = configPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

/** Delete the config file; idempotent. */
export function clearConfig(): void {
  const p = configPath();
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Whether a loaded config has live credentials. */
export function isLoggedIn(cfg: GovernanceConfig | null | undefined): boolean {
  return !!cfg && !!cfg.access_token;
}
