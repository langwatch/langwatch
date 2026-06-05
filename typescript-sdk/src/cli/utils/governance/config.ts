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
   * Personal ingest keys (the project-scoped ingest-only ApiKey
   * `sk-lw-<...>` shape minted by `/api/auth/cli/governance/ingestion-key`),
   * keyed by the tool's source_type slug (`claude_code` / `codex` /
   * `gemini` / `opencode`). One key per source so different wrapped
   * tools surface as their own ingestion source in /me + /messages.
   *
   * When the right key is present for a wrapped tool, the
   * `langwatch <tool>` wrapper injects the standard OTEL_*_EXPORTER
   * env vars pointing at the OTLP endpoint with this key as the
   * Authorization bearer (reusing the cache instead of re-minting).
   *
   * Unset until the wrapper's first auto-mint for that tool.
   */
  default_personal_ingest_keys?: Record<
    string,
    { id?: string; secret?: string; prefix?: string }
  >;

  /**
   * Persistent answer to the post-login "save export block to your
   * shell rc?" prompt. `skip` = user picked "never", stay quiet
   * forever. `undefined` = ask each login that lands in an
   * unconfigured shell. The "not now" answer doesn't persist — it
   * lets the next login re-ask on its own.
   */
  shell_rc_preference?: "skip";

  /**
   * Per-wrapped-tool routing mode answer.
   *
   *   "gateway"   — Path A: route the tool's HTTP calls through
   *                  the AI Gateway via base-URL swap (full server-
   *                  side I/O + cost capture, no client OTel).
   *   "ingestion" — Path B: enable the tool's native OTel exporter
   *                  pointed at /api/otel + mint the user's personal
   *                  ingest key (sk-lw-*). For codex this also writes
   *                  the [otel] block to ~/.codex/config.toml
   *                  automatically.
   *   "ask"       — re-prompt on the next `langwatch <tool>`. The
   *                  default when this key is absent.
   *
   * The two modes are mutually exclusive per the no-double-trace
   * rule — gateway capture + OTel emission on the same call would
   * double-count both traces and cost. The wrapper picks Path A
   * by default when a personal VK is configured, and falls back
   * to Path B when no VK + the user opts in.
   */
  tool_mode?: Record<string, "gateway" | "ingestion" | "ask">;

  /**
   * Most-recent signed `request_increase_url` returned by the
   * gateway in a 402 budget_exceeded payload — cached so
   * `langwatch request-increase` opens the exact URL the gateway
   * produced (with HMAC'd user/limit/spent params).
   */
  last_request_increase_url?: string;
}

function defaults(): GovernanceConfig {
  // Note: the single source of truth for endpoint resolution at command
  // boundaries is `resolveControlPlaneEndpoint()` in resolveEndpoint.ts.
  // This function only seeds the *initial* GovernanceConfig shape when
  // no file exists yet — at boot, before the user has logged in.
  // `LANGWATCH_URL` legacy alias intentionally NOT read (was undocumented;
  // dropped per rchaves directive 2026-05-05).
  const cp = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
  const explicitGw = process.env.LANGWATCH_GATEWAY_URL;
  // Self-hosted detection: when the user pointed `LANGWATCH_ENDPOINT` at
  // localhost (the standard `make dev` shape) and didn't override the
  // gateway URL, default to the local AI gateway port (5563 per
  // langwatch/CLAUDE.md `make service svc=aigateway`). Without this,
  // `langwatch login` + `whoami` printed the production gateway URL on
  // self-hosted installs and the user's `langwatch claude` calls would
  // route at the wrong place (Ariana QA — same shape as the /me tile
  // base-URL bug Sergey c45e69987 / Alexis 30e52a718 fixed on the
  // control-plane side).
  const gw =
    explicitGw ??
    (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cp)
      ? "http://localhost:5563"
      : "https://gateway.langwatch.ai");
  return { gateway_url: gw, control_plane_url: cp };
}

/**
 * Canonical personal-VK secret prefix. Mirrors the control plane's
 * `vk-lw-<ULID>` minting format (langwatch virtualKey.crypto.ts). The
 * gateway rejects anything else as malformed_key before any DB lookup,
 * so a config carrying a legacy-format secret (older `lw_vk_live_*`
 * logins) routes every `langwatch <tool>` call straight to a 401.
 */
const VK_SECRET_PREFIX = "vk-lw-";

/**
 * Whether a stored secret is in the format the current gateway can
 * parse. Legacy secrets minted before the format change fail this and
 * must be re-issued via a fresh login.
 */
export function isCanonicalVkSecret(secret: string | undefined): boolean {
  return !!secret && secret.startsWith(VK_SECRET_PREFIX);
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
    const cfg = { ...defaults(), ...parsed };
    // Drop a legacy-format personal VK secret on load. Keeping it would
    // route every `langwatch <tool>` call to a malformed_key 401; once
    // dropped, the wrapper preflight tells the user to re-login and the
    // next login persists a fresh `vk-lw-` secret. A valid canonical
    // secret is never touched, so this won't wipe a working credential.
    if (
      cfg.default_personal_vk &&
      !isCanonicalVkSecret(cfg.default_personal_vk.secret)
    ) {
      delete cfg.default_personal_vk;
    }
    return cfg;
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
