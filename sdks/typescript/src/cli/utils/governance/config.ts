/**
 * Persists langwatch CLI governance credentials at ~/.langwatch/config.json
 * (mode 0600, atomic rename on save), mirroring `POST /api/auth/cli/exchange`
 * plus a few client-side fields.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PlatformToolPolicyMap } from "./platform-tool-policy";

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
   * The user's personal workspace project, delivered at login. `api_key`
   * is what API-calling commands authenticate with when no
   * `LANGWATCH_API_KEY` is set anywhere.
   */
  personal_project?: {
    id?: string;
    slug?: string;
    name?: string;
    api_key?: string;
    /**
     * Unix epoch (seconds) the device session was last confirmed live for
     * this cached key, so a stolen config can't work forever. See
     * cli/utils/apiKey.ts resolveSessionProjectKey.
     */
    validated_at?: number;
  };

  /**
   * The user-scoped API key minted for this login, reaching every project
   * picked on the authorize screen. Absent for a legacy server; the
   * resolver falls back to `personal_project.api_key`.
   */
  cli_api_key?: string;

  /**
   * What `cli_api_key` reaches, as the exchange reported it. `organization`
   * means every project of the organization, now and later; `projects` means
   * the listed ids only. Read by `langwatch whoami` to summarise the login.
   */
  cli_api_key_scope?: {
    kind: "organization" | "projects";
    project_ids: string[];
    /**
     * The permission slugs the key was minted with, so `whoami` can say what
     * the key can do beside where it reaches. Absent when the login predates
     * the field.
     */
    permissions?: string[];
  };

  /**
   * Personal ingest keys (write-only, `ik-lw-{lookupId}_{secret}`), keyed by
   * the tool's source_type slug so each wrapped tool surfaces as its own
   * ingestion source. A secret that doesn't parse as `ik-lw-` is user-pinned.
   */
  default_personal_ingest_keys?: Record<string, { id?: string; secret?: string; prefix?: string }>;

  /**
   * Per-tool project scope, written by `instrument <tool> --project/--key`
   * and removed by `--personal`/`logout`. `project_id`/`project_slug` are
   * absent when pasted (`--key`) rather than minted.
   */
  tool_project_keys?: Record<
    string,
    {
      secret: string;
      project_id?: string;
      project_slug?: string;
      endpoint?: string;
    }
  >;

  /**
   * Persistent answer to the post-login "save export block to your shell
   * rc?" prompt. `skip` = never ask again; undefined = ask each login. The
   * "not now" answer doesn't persist.
   */
  shell_rc_preference?: "skip";

  /**
   * Unix epoch (seconds) of the last failed plugin-install attempt.
   * Suppresses retrying for a day. Cleared by a successful install; absent
   * means never failed or last attempt succeeded.
   */
  claude_plugin_last_failure?: number;

  /**
   * Unix epoch (seconds) of the last plugin-update check. Claude Code
   * leaves auto-update off for third-party marketplaces, so the wrapper
   * checks at most once a day. Absent = never checked.
   */
  claude_plugin_last_update_check?: number;

  /**
   * Per-wrapped-tool routing mode: "gateway" routes HTTP calls through the
   * AI Gateway; "ingestion" enables the tool's native OTel exporter; "ask"
   * re-prompts (default). Mutually exclusive per the no-double-trace rule.
   */
  tool_mode?: Record<string, "gateway" | "ingestion" | "ask">;

  /**
   * Per-(org, tool) path policy cached from login bootstrap, gating which
   * paths the wrapper offers. Absent for a legacy/offline CLI;
   * `resolvePlatformToolPolicy` then falls back to hardcoded defaults.
   */
  tool_policies?: PlatformToolPolicyMap;

  /**
   * Persistent opt-out from the background command daemon. Absent = on;
   * `LANGWATCH_NO_DAEMON` takes precedence when both are set. Also read
   * directly by cli/daemon/eligibility.ts — keep the field name in sync.
   */
  daemon?: "on" | "off";

  /**
   * The agent last chosen by `langwatch agent tunnel`, keyed by project
   * directory, so the next run in the same folder skips the picker.
   * `--agent` always overrides.
   */
  agent_dev_agents?: Record<string, string>;
}

function defaults(): GovernanceConfig {
  // This only seeds the initial shape when no config file exists yet, at
  // boot before login; `resolveControlPlaneEndpoint()` in resolveEndpoint.ts
  // is the source of truth at command boundaries.
  const cp = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
  const explicitGw = process.env.LANGWATCH_GATEWAY_URL;
  // Self-hosted detection: a localhost LANGWATCH_ENDPOINT with no gateway
  // override defaults to the local AI gateway port (see langwatch/CLAUDE.md
  // `make service svc=aigateway`), so self-hosted installs route locally.
  const gw =
    explicitGw ??
    (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cp)
      ? "http://localhost:5563"
      : "https://gateway.langwatch.ai");
  return { gateway_url: gw, control_plane_url: cp };
}

/**
 * Canonical personal-VK secret prefix, mirroring the control plane's
 * `vk-lw-<ULID>` minting format. The gateway rejects anything else as
 * malformed_key, so a legacy-format secret 401s every `langwatch <tool>` call.
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

/** Whether a stored `cli_api_key_scope` is in the shape `whoami` can read. */
function isWellFormedCliKeyScope(scope: GovernanceConfig["cli_api_key_scope"]): boolean {
  if (!scope) return false;
  if (scope.kind !== "organization" && scope.kind !== "projects") return false;
  if (
    !Array.isArray(scope.project_ids) ||
    !scope.project_ids.every((id) => typeof id === "string")
  ) {
    return false;
  }
  // An organization scope carries no project ids by definition. A scope
  // holding both would have `whoami` report "whole organization" while the
  // list says otherwise, so refuse it as malformed.
  if (scope.kind === "organization" && scope.project_ids.length > 0) {
    return false;
  }
  return true;
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

/**
 * Read the config from disk, merging in defaults for missing keys.
 * Deliberately re-read on EVERY call, with no in-process cache — see
 * cli/daemon/identity.ts.
 */
export function loadConfig(): GovernanceConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return defaults();
  try {
    const text = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(text) as Partial<GovernanceConfig>;
    const cfg = { ...defaults(), ...parsed };
    // Drop a legacy-format personal VK secret on load; the next login
    // persists a fresh `vk-lw-` one. Canonical secrets are never touched.
    if (cfg.default_personal_vk && !isCanonicalVkSecret(cfg.default_personal_vk.secret)) {
      delete cfg.default_personal_vk;
    }
    // Same reasoning for a hand-edited project pin missing its `secret`.
    if (cfg.tool_project_keys) {
      cfg.tool_project_keys = Object.fromEntries(
        Object.entries(cfg.tool_project_keys).filter(
          ([, pin]) => typeof pin?.secret === "string" && pin.secret !== "",
        ),
      );
    }
    // A blank or non-string `cli_api_key` is a hand-edit, not a credential;
    // drop it and its scope so the resolver degrades to the personal-project path.
    if (typeof cfg.cli_api_key !== "string" || cfg.cli_api_key.trim() === "") {
      delete cfg.cli_api_key;
      delete cfg.cli_api_key_scope;
    } else if (!isWellFormedCliKeyScope(cfg.cli_api_key_scope)) {
      delete cfg.cli_api_key_scope;
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
