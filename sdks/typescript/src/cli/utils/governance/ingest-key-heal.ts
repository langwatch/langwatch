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
 * Re-mint the personal ingest key for `agent` and rewrite its wiring.
 *
 * Declines, without reaching the platform, when this device is not in a
 * position to repair the 401: no login to mint with, a tool pinned to a
 * project (that path is `langwatch instrument --project`), or a rejected
 * token that is not exactly the cached personal key (a pasted credential is
 * the user's, never overwritten, and a request that carried no bearer at all
 * was rejected for another reason).
 *
 * A token read out of the AGENT'S OWN WIRING is the one exception to that
 * cached-key identity check (`rejectedTokenSource: "wiring"`, #7958): the
 * cache and the wiring can drift, and the drifted wired key is exactly the
 * credential the agent's exporter is dying on. Its place in the settings
 * file does not make it this device's, though — a person can wire that file
 * to any collector by hand — so ownership is established from the token
 * itself: it has to be a personal ingest key (`ik-lw-…`, the only kind
 * `installTelemetryWiring` writes) AND the platform has to recognise it as
 * one of this account's. A wired token the platform does not know declines,
 * where a cached one would mint: the cache is this device's own record, the
 * wiring is not.
 *
 * Withholds the repair when the platform says a person revoked the cached
 * key, or recorded no cause for the revoke. A revoke from the API-keys page
 * is a decision about this device, and a device that minted its way past it
 * would make that page a no-op. A key retired with its session, replaced by
 * a rotation or evicted by an older server's cap is re-minted; one retired
 * because its person was offboarded reads as a sign-out instead, since the
 * mint would be refused anyway.
 *
 * Reports a failure once it has gone to the platform and not come back with a
 * wired tool that this device can recognise again: a status call that did not
 * answer inside its deadline, a server that says the cached key is still
 * live, in which case the 401 means something else, or a key that minted but
 * could not be written into the cache or into the tool's wiring.
 */
export async function healRevokedIngestKey({
  agent,
  rejectedToken,
  rejectedTokenSource = "cache",
  deps = REAL_DEPS,
}: {
  agent: string;
  /** The bearer the collector answered 401 to, without the `Bearer ` word. */
  rejectedToken: string | undefined;
  /**
   * Where the rejected bearer was read from. `"cache"` (the default) is the
   * CLI's own config and demands identity with the cached key; `"wiring"`
   * says the caller read it out of the agent's wired settings file, where
   * drift from the cache is the very defect being repaired (#7958).
   */
  rejectedTokenSource?: "cache" | "wiring";
  deps?: HealDeps;
}): Promise<HealOutcome> {
  const tool = TOOL_BY_AGENT[agent];
  if (!tool) return DECLINED;

  const cfg = deps.loadConfig();
  if (!deps.isLoggedIn(cfg)) return DECLINED;
  if (cfg.tool_project_keys?.[tool]?.secret) return DECLINED;

  // Only a key this device wrote is ours to replace. For the cache source
  // that means identity with the cached personal key: a 401 the device
  // carried no bearer for, or carried someone else's, is not this key's
  // failure. For the wiring source the settings file proves nothing by
  // itself, so the bearer has to be a personal ingest key — anything else
  // (a pasted credential, a project key) was never this path's to write —
  // and the platform has to know it as this account's, checked below.
  const cached = cfg.default_personal_ingest_keys?.[agent]?.secret;
  if (!rejectedToken) return DECLINED;
  if (rejectedTokenSource === "cache" && (!cached || rejectedToken !== cached)) {
    return DECLINED;
  }
  if (
    rejectedTokenSource === "wiring" &&
    !extractLookupIdFromToken(rejectedToken)
  ) {
    return DECLINED;
  }

  const blocked = await revocationBlocksHeal({
    cfg,
    rejected: rejectedToken,
    mustBeKnown: rejectedTokenSource === "wiring",
    deps,
  });
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
 * The status check that stands between the 401 and the mint, as an outcome
 * when it ends the heal and `null` when the key may be replaced.
 *
 * A platform that does not answer is not a platform that said "re-mint". The
 * one revocation the device must not mint past is a person's, so a status
 * call that times out or errors ends the heal rather than falling through to
 * the mint; the next session asks again once the window is up.
 *
 * A platform that refused the session is the same wall for a different
 * reason: the mint after this check would be refused too, so the heal ends
 * on `expired`, which is the one outcome that names a repair the person can
 * make. A key retired because its person was offboarded is that same wall,
 * read from the key rather than from a refused call.
 *
 * `unknown` — the platform has no such key of THIS account's — is read two
 * ways. For the cached key it is a server from before causes were recorded,
 * or a key the cap evicted long ago, and the device repairs itself. For a
 * key read out of the wiring (`mustBeKnown`) it is the end of the heal: the
 * only proof that wiring is this device's is the platform recognising its
 * key, and a key it does not recognise may be another account's or another
 * collector's, whose wiring a mint here would overwrite.
 */
async function revocationBlocksHeal({
  cfg,
  rejected,
  mustBeKnown = false,
  deps,
}: {
  cfg: GovernanceConfig;
  /** The rejected bearer itself — cached or wired, whichever 401'd. */
  rejected: string;
  /** Decline, rather than mint, when the platform does not know the key. */
  mustBeKnown?: boolean;
  deps: HealDeps;
}): Promise<HealOutcome | null> {
  const lookupId = extractLookupIdFromToken(rejected);
  if (!lookupId) return null;

  const described = await deps
    .describeIngestionKey(cfg, lookupId, { timeoutMs: DESCRIBE_TIMEOUT_MS })
    .catch((error: unknown) => (isExpiredSession(error) ? EXPIRED_SESSION : null));
  if (!described) return { status: "failed" };
  if (described === EXPIRED_SESSION) return { status: "expired" };
  if (described.status === "unknown" && mustBeKnown) return DECLINED;
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
