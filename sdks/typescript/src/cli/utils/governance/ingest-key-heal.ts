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
import { describeIngestionKey, extractLookupIdFromToken } from "./cli-api";
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

/**
 * How a heal ended, and whether it cost anything.
 *
 * The split the caller cares about is `declined` against the other three. A
 * decline is decided from the config alone, before any network call: this
 * device is not the one that can repair this 401, and running again a second
 * later would decide the same thing just as cheaply. The other three went to
 * the platform. A `failed` heal may already have spent a mint, so it is the
 * one that must not be retried in a loop. A `withheld` heal found that a
 * person revoked the key on purpose: the device must not replace it, and the
 * person must be told to set the device up again. Throttling a decline would
 * spend a repair window on a rejection that never cost anything, and delay
 * the real repair.
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
 * its own, so a connection that opens and never answers would hold the
 * session open. Matches the deadline the hook posts its own record with.
 */
const DESCRIBE_TIMEOUT_MS = 3_000;

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
 * Withholds the repair when the platform says a person revoked the cached key
 * on purpose. A revoke from the API-keys page is a decision about this device,
 * and a device that minted its way past it would make that page a no-op. The
 * platform's own revocations, a rotation or the cap, are re-minted.
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

  const lookupId = extractLookupIdFromToken(cached);
  if (lookupId) {
    // A platform that does not answer is not a platform that said "re-mint".
    // The one revocation the device must not mint past is a person's, so a
    // status call that times out or errors ends the heal rather than falling
    // through to the mint; the next session asks again once the window is up.
    const described = await deps
      .describeIngestionKey(cfg, lookupId, { timeoutMs: DESCRIBE_TIMEOUT_MS })
      .catch(() => null);
    if (!described) return { status: "failed" };
    if (described.status === "revoked" && described.revocationCause === "user") {
      return { status: "withheld" };
    }
  }

  const resolved = await deps.resolveLiveIngestionKey({
    cfg,
    sourceType: agent,
    allowOfflineFallback: false,
  });
  if (!resolved.minted) return { status: "failed" };

  // The cache and the wiring must never name different keys. The next 401 is
  // repaired only when the rejected bearer is the key the cache holds, so a
  // pair that disagrees declines a repair this device could have made. The
  // cache is written first and put back when the wiring lands no target, and
  // a cache that cannot be written at all is a failed heal rather than a
  // healed one whose key this device would not recognise next time.
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
