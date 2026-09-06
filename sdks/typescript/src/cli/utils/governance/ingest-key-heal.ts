/**
 * Heal a personal ingest key the collector rejected, by re-minting through
 * the same resolver `langwatch instrument` uses. Nothing here throws to the
 * caller: every failure is a null and a debug line.
 */
import { installTelemetryWiring } from "./instrument-wiring";
import { describeIngestionKey, extractLookupIdFromToken } from "./cli-api";
import { type GovernanceConfig, isLoggedIn, loadConfig, saveConfig } from "./config";
import { resolveLiveIngestionKey } from "./telemetry-refresh";

/** The wiring target for one agent's OTLP logs, and what authenticates it. */
export interface HealedTarget {
  endpoint: string;
  headers: Record<string, string>;
}

/**
 * How a heal ended. `declined` is decided from config alone, never needing
 * throttling. `failed` may have already spent a mint, so it must not loop;
 * `withheld` found a person revoked the key on purpose.
 */
export type HealOutcome =
  | { status: "declined" }
  | { status: "failed" }
  | { status: "withheld" }
  | { status: "healed"; target: HealedTarget };

const DECLINED: HealOutcome = { status: "declined" };

/** The seams the healer composes, injectable so a test needs no real config. */
export interface HealDeps {
  loadConfig: () => GovernanceConfig;
  saveConfig: (cfg: GovernanceConfig) => void;
  isLoggedIn: (cfg: GovernanceConfig) => boolean;
  describeIngestionKey: typeof describeIngestionKey;
  resolveLiveIngestionKey: typeof resolveLiveIngestionKey;
  installTelemetryWiring: typeof installTelemetryWiring;
}

const REAL_DEPS: HealDeps = {
  loadConfig,
  saveConfig,
  isLoggedIn,
  describeIngestionKey,
  resolveLiveIngestionKey,
  installTelemetryWiring,
};

/**
 * How long the healer waits for the platform to say what became of the key.
 * The hook runs on the session's critical path and fetch has no timeout of
 * its own.
 */
const DESCRIBE_TIMEOUT_MS = 3_000;

/**
 * The revocations the platform did on its own, which a device may repair. A
 * person's revoke, and a revoke recorded with no cause, are not in this set.
 */
const PLATFORM_REVOCATION_CAUSES: ReadonlySet<string | null> = new Set(["cap", "rotation"]);

/** The wiring tool slug for each agent the hook runs for. */
const TOOL_BY_AGENT: Record<string, string> = {
  claude_code: "claude",
  codex: "codex",
  opencode: "opencode",
};

/**
 * Re-mint the personal ingest key for `agent` and rewrite its wiring.
 * Declines, without reaching the platform, when this device can't repair
 * the 401. Withholds the repair when a person revoked the key on purpose.
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
}): Promise<HealOutcome> {
  const tool = TOOL_BY_AGENT[agent];
  if (!tool) return DECLINED;

  const cfg = deps.loadConfig();
  if (!deps.isLoggedIn(cfg)) return DECLINED;
  if (cfg.tool_project_keys?.[tool]?.secret) return DECLINED;

  // Only the cached personal key is ours to replace, and only when it is
  // demonstrably the credential that was rejected. A 401 the device carried
  // no bearer for, or carried someone else's, is not this key's failure.
  const cached = cfg.default_personal_ingest_keys?.[agent]?.secret;
  if (!cached || rejectedToken !== cached) return DECLINED;

  const blocked = await revocationBlocksHeal({ cfg, cached, deps });
  if (blocked) return blocked;

  const resolved = await deps.resolveLiveIngestionKey({
    cfg,
    sourceType: agent,
    allowOfflineFallback: false,
  });
  if (!resolved.minted) return { status: "failed" };

  return adoptMintedKey({ agent, tool, cfg, resolved, deps });
}

/**
 * The status check that stands between the 401 and the mint: an outcome
 * when it ends the heal, `null` when the key may be replaced.
 */
async function revocationBlocksHeal({
  cfg,
  cached,
  deps,
}: {
  cfg: GovernanceConfig;
  cached: string;
  deps: HealDeps;
}): Promise<HealOutcome | null> {
  const lookupId = extractLookupIdFromToken(cached);
  if (!lookupId) return null;

  const described = await deps
    .describeIngestionKey(cfg, lookupId, { timeoutMs: DESCRIBE_TIMEOUT_MS })
    .catch(() => null);
  if (!described) return { status: "failed" };
  if (
    described.status === "revoked" &&
    !PLATFORM_REVOCATION_CAUSES.has(described.revocationCause)
  ) {
    return { status: "withheld" };
  }
  return null;
}

/**
 * Put a freshly minted key into the cache and the tool's wiring, or leave
 * both naming the key that was there before — they must never disagree.
 * The cache is written first and put back when the wiring lands no target.
 */
function adoptMintedKey({
  agent,
  tool,
  cfg,
  resolved,
  deps,
}: {
  agent: string;
  tool: string;
  cfg: GovernanceConfig;
  resolved: Awaited<ReturnType<HealDeps["resolveLiveIngestionKey"]>>;
  deps: HealDeps;
}): HealOutcome {
  const cachedKeys = cfg.default_personal_ingest_keys;
  cfg.default_personal_ingest_keys = {
    ...(cachedKeys ?? {}),
    [agent]: { secret: resolved.token, prefix: resolved.prefix },
  };
  try {
    deps.saveConfig(cfg);
  } catch {
    cfg.default_personal_ingest_keys = cachedKeys;
    return { status: "failed" };
  }

  // An install that wrote no target is a failed heal too, not only one that
  // reports a required failure: both leave the tool on the dead key, so the
  // cache goes back to naming it.
  const wiring = deps.installTelemetryWiring({
    cfg,
    tool,
    endpoint: resolved.endpoint,
    token: resolved.token,
  });
  if (wiring.requiredFailures.length > 0 || wiring.labels.length === 0) {
    cfg.default_personal_ingest_keys = cachedKeys;
    try {
      deps.saveConfig(cfg);
    } catch {
      // The write that put the new key there succeeded a moment ago, so this
      // one failing costs the device the heal it would make on the next 401.
    }
    return { status: "failed" };
  }

  return {
    status: "healed",
    target: {
      endpoint: `${resolved.endpoint}/v1/logs`,
      headers: { Authorization: `Bearer ${resolved.token}` },
    },
  };
}
