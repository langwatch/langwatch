import { describeIngestionKey, extractLookupIdFromToken, isExpiredSession } from "./cli-api";
import { type GovernanceConfig, isLoggedIn, loadConfig, saveConfig } from "./config";
/**
 * Heals a personal ingest key the collector rejected: re-mints it under the device's current
 * session and rewrites the tool's wiring. Never throws to the caller — every failure degrades
 * to a null and a debug line, so a dead key can't be why a running agent's session breaks.
 */
import { installTelemetryWiring } from "./instrument-wiring";
import { resolveLiveIngestionKey } from "./telemetry-refresh";

/** The wiring target for one agent's OTLP logs, and what authenticates it. */
export interface HealedTarget {
  endpoint: string;
  headers: Record<string, string>;
}

/**
 * How a heal ended. `declined` costs nothing and is safe to retry; `failed` may have already
 * spent a mint, so must not be retried in a loop; `withheld` means the device must be set up
 * again rather than retried; `expired` means the device is signed out, which no retry can fix.
 */
export type HealOutcome =
  | { status: "declined" }
  | { status: "failed" }
  | { status: "withheld" }
  | { status: "expired" }
  | { status: "healed"; target: HealedTarget };

const DECLINED: HealOutcome = { status: "declined" };

/**
 * Stands in for a key status the platform never gave, because it refused the device's
 * session instead of answering. Distinct from a plain `null` so the heal can end on the
 * expired-session repair rather than a silent failure.
 */
const EXPIRED_SESSION = Symbol("expired-session");

/** The collaborators the healer composes, injectable so a test needs no real config. */
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
 * The one revocation a device must not mint past: a person's. Every other cause is the
 * platform's own doing, and the device repairs itself under its current session. A revoke
 * recorded with no cause may have been a person's, so it counts as one.
 */
const USER_REVOCATION_CAUSE = "user";

/**
 * The person lost their membership of the organization, so the session that held this key
 * was retired with them. A mint would be refused for the same reason, so the heal ends here
 * on the signed-out outcome rather than spending a round trip to be told so.
 */
const OFFBOARDED_REVOCATION_CAUSE = "offboarded";

/** The wiring tool slug for each agent the hook runs for. */
const TOOL_BY_AGENT: Record<string, string> = {
  claude_code: "claude",
  codex: "codex",
  opencode: "opencode",
};

/**
 * Re-mints the personal ingest key for `agent` and rewrites its wiring, declining without a
 * platform call when this device can't repair the 401. {@link revocationBlocksHeal} decides
 * whether the platform withholds the repair instead of granting it.
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
 * The status check between the 401 and the mint: an outcome ends the heal, `null` means the
 * key may still be replaced. A call that errors or times out also ends the heal — a platform
 * that didn't answer never said "safe to re-mint" — and a refused session ends on `expired`.
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
    .catch((error: unknown) => (isExpiredSession(error) ? EXPIRED_SESSION : null));
  if (!described) return { status: "failed" };
  if (described === EXPIRED_SESSION) return { status: "expired" };
  if (described.status === "revoked") {
    if (described.revocationCause === USER_REVOCATION_CAUSE || described.revocationCause === null) {
      return { status: "withheld" };
    }
    if (described.revocationCause === OFFBOARDED_REVOCATION_CAUSE) {
      return { status: "expired" };
    }
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
    ...cachedKeys,
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
      void 0;
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
