/**
 * Heal a personal ingest key the collector rejected.
 *
 * Personal ingest keys are minted per device, but a key can still die under a
 * running agent: a revoke from the API-keys page, an old server that rotated
 * in place, the cap evicting a machine that sat idle. The agent's own OTLP
 * exporter fails silently on the 401, and until now so did the session
 * context hook. The hook is the one process that learns the key is dead on
 * every session, so it is where the repair belongs: re-mint through the same
 * resolver `langwatch instrument` uses, persist the cache, rewrite the tool's
 * wiring, and hand back a target for the retry.
 *
 * Nothing here throws to the caller: the hook is never allowed to be why a
 * session broke, so every failure is a null and a debug line.
 */
import { installTelemetryWiring } from "./instrument-wiring";
import {
  type GovernanceConfig,
  isLoggedIn,
  loadConfig,
  saveConfig,
} from "./config";
import { resolveLiveIngestionKey } from "./telemetry-refresh";

/** The wiring target for one agent's OTLP logs, and what authenticates it. */
export interface HealedTarget {
  endpoint: string;
  headers: Record<string, string>;
}

/** The seams the healer composes, injectable so a test needs no real config. */
export interface HealDeps {
  loadConfig: () => GovernanceConfig;
  saveConfig: (cfg: GovernanceConfig) => void;
  isLoggedIn: (cfg: GovernanceConfig) => boolean;
  resolveLiveIngestionKey: typeof resolveLiveIngestionKey;
  installTelemetryWiring: typeof installTelemetryWiring;
}

const REAL_DEPS: HealDeps = {
  loadConfig,
  saveConfig,
  isLoggedIn,
  resolveLiveIngestionKey,
  installTelemetryWiring,
};

/** The wiring tool slug for each agent the hook runs for. */
const TOOL_BY_AGENT: Record<string, string> = {
  claude_code: "claude",
  codex: "codex",
  opencode: "opencode",
};

/**
 * Re-mint the personal ingest key for `agent` and rewrite its wiring, or null
 * when this device is not in a position to: no login to mint with, a tool
 * pinned to a project (that path is `langwatch instrument --project`), a
 * rejected token that is not the cached personal key (a pasted credential is
 * the user's, never overwritten), or a server that says the cached key is
 * still live, in which case the 401 means something else.
 */
export async function healRevokedIngestKey({
  agent,
  rejectedToken,
  deps = REAL_DEPS,
}: {
  agent: string;
  /** The bearer the collector answered 401 to, without the `Bearer ` word. */
  rejectedToken: string | undefined;
  deps?: HealDeps;
}): Promise<HealedTarget | null> {
  const tool = TOOL_BY_AGENT[agent];
  if (!tool) return null;

  const cfg = deps.loadConfig();
  if (!deps.isLoggedIn(cfg)) return null;
  if (cfg.tool_project_keys?.[tool]?.secret) return null;

  const cached = cfg.default_personal_ingest_keys?.[agent]?.secret;
  if (!cached || (rejectedToken !== undefined && rejectedToken !== cached)) {
    return null;
  }

  const resolved = await deps.resolveLiveIngestionKey({
    cfg,
    sourceType: agent,
    allowOfflineFallback: false,
  });
  if (!resolved.minted) return null;

  cfg.default_personal_ingest_keys = {
    ...(cfg.default_personal_ingest_keys ?? {}),
    [agent]: { secret: resolved.token, prefix: resolved.prefix },
  };
  try {
    deps.saveConfig(cfg);
  } catch {
    // The wiring below still lands; only the cache write failed.
  }

  const wiring = deps.installTelemetryWiring({
    cfg,
    tool,
    endpoint: resolved.endpoint,
    token: resolved.token,
  });
  if (wiring.requiredFailures.length > 0) return null;

  return {
    endpoint: `${resolved.endpoint}/v1/logs`,
    headers: { Authorization: `Bearer ${resolved.token}` },
  };
}
