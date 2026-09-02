/**
 * The API process's four Langy REST doors, and what it can and cannot put
 * behind each of them.
 *
 * Behaviour is package-owned (`@langwatch/langy-server`); this supplies the
 * capabilities that are the PROCESS's — how a project credential is read off a
 * request and checked against its ceiling, which flag store answers the
 * rollout, which Redis the live edge lives in, which counters the internal
 * callbacks publish, and which user directory a key's owner is read from.
 *
 * Two of the four are conditional on Redis, and the condition is not
 * squeamishness. The UI-action channel IS a Redis claim key, a result list and
 * a blocking pop; the relay IS a Redis stream plus a dedup set. A process with
 * no Redis mounting either would accept a dispatch nothing can deliver and a
 * frame nothing can read back, which the caller cannot detect. The turn surface
 * has no such dependency — `Prefer: wait` degrades to fold reads — so it mounts
 * either way.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  LangyUiActionRestCatalogPort,
  type LangyActorUserReader,
  type LangyInternalMetricsPort,
  type LangyInternalRestPorts,
  type LangyRestCeilingPort,
  type LangyRestCredentialPorts,
  type LangyRelayRestPorts,
  type LangyTurnsRestPorts,
  type LangyUiActionsRestPorts,
  type LangyApp,
} from "@langwatch/langy-server";
import type { UiActionRedis } from "@langwatch/langy-server";
import type { RedisConnection } from "@langwatch/redis-client";
import { Counter, register } from "prom-client";

import { extractApiKeyRequestCredentials } from "../../app/api-key-request-credentials";

/** Everything this process can hand the Langy doors, where it has them. */
export type ApiLangyRestComposition = Readonly<{
  turns: LangyTurnsRestPorts;
  /** Absent where this process composed no Redis. */
  uiActions?: LangyUiActionsRestPorts | undefined;
  internal: LangyInternalRestPorts;
  /** Absent for the same reason `uiActions` is. */
  relay?: LangyRelayRestPorts | undefined;
}>;

export type ApiLangyRestOptions = Readonly<{
  langy: LangyApp | undefined;
  apiKeys: ApiKeyService | undefined;
  featureFlags: FeatureFlagService | undefined;
  /** The user directory a key's owning person is read from. */
  actors: LangyActorUserReader | undefined;
  /** Enforces one permission as an already-resolved key's ceiling. */
  enforceCeiling: LangyRestCeilingPort;
  redis: RedisConnection | undefined;
  /** The shared bearer the agent presents on its callbacks, or none. */
  internalSecret: string | undefined;
  metrics: LangyRestMetricsPorts;
}>;

/** The counters the internal doors publish, as this process registers them. */
export type LangyRestMetricsPorts = Readonly<{
  internal: LangyInternalMetricsPort;
  relayFrames: LangyRelayRestPorts["metrics"];
}>;

/**
 * The page-action catalogue, absent — and therefore every kind unknown.
 *
 * The only catalogue that exists is the experiments workbench's, and it is a
 * browser module: a server package may not reach it and neither may this
 * process. So `GET /api/langy/ui/actions` answers an EMPTY list rather than a
 * wrong one, and a dispatch refuses by name with `langy_ui_action_unknown`.
 * Both are honest: an agent reading the list learns there is nothing to call
 * here, which is exactly true of this process.
 */
class UnavailableApiLangyUiActionCatalog extends LangyUiActionRestCatalogPort {
  tryFind(): null {
    return null;
  }

  list(): readonly never[] {
    return [];
  }
}

/**
 * Composes the Langy REST ports, or none.
 *
 * `undefined` when any of the four collaborators every door shares is missing —
 * the application, the credential directory, the flag store or the user
 * directory. Absent beats mounted: a turn door with no flag store cannot tell
 * an open surface from a dark one, and a door that cannot tell answers the
 * wrong 404 to somebody who should have been served.
 */
export function composeApiLangyRest(
  options: ApiLangyRestOptions,
): ApiLangyRestComposition | undefined {
  const { langy, apiKeys, featureFlags, actors, redis } = options;
  if (!langy || !apiKeys || !featureFlags || !actors) return undefined;

  const credentials: LangyRestCredentialPorts = {
    readCredential: (request) => extractApiKeyRequestCredentials(request),
    apiKeys: () => apiKeys,
    enforceCeiling: options.enforceCeiling,
    featureFlags: () => featureFlags,
    actors: () => actors,
  };

  const internal: LangyInternalRestPorts = {
    langy: () => langy,
    internalSecret: () => options.internalSecret,
    metrics: options.metrics.internal,
  };

  return {
    turns: {
      ...credentials,
      langy: () => langy,
      redis: () => redis ?? null,
    },
    internal,
    ...(redis
      ? {
          uiActions: {
            ...credentials,
            langy: () => langy,
            redis: () => redis as unknown as UiActionRedis,
            actions: () => new UnavailableApiLangyUiActionCatalog(),
          },
          relay: {
            langy: () => langy,
            hasLiveBuffer: () => true,
            internalSecret: () => options.internalSecret,
            metrics: options.metrics.relayFrames,
          },
        }
      : {}),
  };
}

/**
 * The Langy counters, on the process-global Prometheus registry.
 *
 * Global rather than a registry of this composition's own, for the reason
 * {@link ApiMetricsInfrastructure} states: the scrape surface serves
 * `prom-client`'s process registry, and a counter registered anywhere else
 * would increment forever without ever reaching a scrape.
 *
 * `getSingleMetric` guards re-registration rather than `removeSingleMetric`
 * clearing it: a second composition in one process (a test, a second listener)
 * must share the counter, and removing it would silently reset every series
 * the first one had already published.
 */
export function apiLangyRestMetrics(): LangyRestMetricsPorts {
  const turnResults = counter({
    name: "langwatch_langy_turn_results_total",
    help: "Langy turn results ingested over the durable internal endpoint, by outcome",
    labelNames: ["outcome"],
  });
  const sessionKeys = counter({
    name: "langwatch_langy_session_keys_total",
    help: "Langy session API keys by lifecycle operation",
    labelNames: ["op"],
  });
  const relayFrames = counter({
    name: "langwatch_langy_relay_frames_total",
    help: "Langy relay frames by processing result, summed per stream at close",
    labelNames: ["result"],
  });
  return {
    internal: {
      turnResult: (outcome) => turnResults.labels(outcome).inc(),
      sessionKeyRevokeRefused: () => sessionKeys.labels("revoke_refused").inc(),
    },
    relayFrames: {
      frames: (outcome, count) => relayFrames.labels(outcome).inc(count),
    },
  };
}

function counter(options: {
  name: string;
  help: string;
  labelNames: readonly string[];
}): Counter<string> {
  const existing = register.getSingleMetric(options.name);
  if (existing) return existing as Counter<string>;
  return new Counter({
    name: options.name,
    help: options.help,
    labelNames: [...options.labelNames],
    registers: [register],
  });
}
