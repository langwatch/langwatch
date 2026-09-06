/**
 * The API process's four Langy REST doors, and what it can and cannot put behind each of them.
 */
import { LangyTokenBufferAdapter, SkipPermissionsService } from "@langwatch/langy-server";
import { LangyUiNoBrowserError } from "@langwatch/langy-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  LangyUiActionBackendService,
  type LangyActorUserReader,
  type LangyInternalMetricsPort,
  type LangyInternalRestPorts,
  type LangyRestCeilingPort,
  type LangyRestCredentialPorts,
  type LangyRelayRestPorts,
  type LangyTurnsRestPorts,
  type LangyUiActionsRestPorts,
  type LangyApp,
  type LangyCodeAccessPreferenceReader,
  type LangyGithubInstallationReader,
  type LangyLocalRestCommands,
  type LangyLocalControlRestPorts,
  type LangyLocalRestPorts,
  type SkipPermissionsProviderRows,
  type LocalControlLongPoll,
  type LocalControlRuntime,
} from "@langwatch/langy-server";
import type { UiActionRedis } from "@langwatch/langy-server";
import type { RedisConnection } from "@langwatch/redis-client";
import { Counter, register } from "prom-client";

import { extractApiKeyRequestCredentials } from "../../app/api-key-request-credentials.ts";
import {
  ApiWorkbenchUiActionBackend,
  ApiWorkbenchUiActionCatalog,
  type ApiLangyWorkbenchPeer,
} from "./langy-workbench-actions.adapter.ts";

/** Everything this process can hand the Langy doors, where it has them. */
export type ApiLangyRestComposition = Readonly<{
  turns: LangyTurnsRestPorts;
  /** Absent where this process composed no Redis. */
  uiActions?: LangyUiActionsRestPorts | undefined;
  internal: LangyInternalRestPorts;
  /** Absent for the same reason `uiActions` is. */
  relay?: LangyRelayRestPorts | undefined;
  /**
   * The worker's door onto the developer's folder (ADR-129). Absent where this
   * process composed none of what local control needs.
   */
  local?: LangyLocalRestPorts | undefined;
  /** The command line's own door: the control requests and the long poll. */
  localControl?: LangyLocalControlRestPorts | undefined;
}>;

/**
 * What the local-control door needs beyond what every Langy door shares. Absent
 * means the family is not mounted at all, rather than mounted onto refusals.
 */
export type ApiLangyLocalOptions = Readonly<{
  /** ONE runtime for this process, shared with the panel's own procedures. */
  runtime: LocalControlRuntime;
  /** This process's long-poll sessions, over that same runtime. */
  longPoll: LocalControlLongPoll;
  /** All sixteen conversation writes, as this process produces them. */
  commands: LangyLocalRestCommands;
  /** The person's own code access choice. */
  users: LangyCodeAccessPreferenceReader;
  /** Whether the organization installed the GitHub App. */
  github: LangyGithubInstallationReader;
  /** The provider rows the skip gate reads the allowed models off. */
  providerRows: SkipPermissionsProviderRows;
  /** This deployment's own origin, for the follow-along link. */
  baseHost: string | undefined;
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
  /**
   * The experiments workbench, where this process composed one. Absent means an
   * away page is a refusal rather than a silent backend run — the honest answer
   * for a process that holds no workbench execution stack.
   */
  workbench: (() => ApiLangyWorkbenchPeer | null) | undefined;
  /** Local control, where this process composed it. */
  local: ApiLangyLocalOptions | undefined;
}>;

/** The counters the internal doors publish, as this process registers them. */
export type LangyRestMetricsPorts = Readonly<{
  internal: LangyInternalMetricsPort;
  relayFrames: LangyRelayRestPorts["metrics"];
}>;

/**
 * Composes the Langy REST ports, or none. `undefined` when any of the four collaborators every
 * door shares is missing — the application, the credential directory, the flag store or the
 * user directory.
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

  const local = composeLocal({ options, credentials, langy });

  return {
    ...(local ? { local } : {}),
    ...(options.local
      ? {
          localControl: {
            runtime: () => options.local!.runtime,
            longPoll: () => options.local!.longPoll,
            baseHost: options.local!.baseHost,
          },
        }
      : {}),
    turns: {
      ...credentials,
      langy: () => langy,
      openTurnBuffer: () => {
        if (!redis) return null;
        const blocking = redis.duplicate();

        return {
          buffer: LangyTokenBufferAdapter.create({ redis, blockingRedis: blocking }),
          release: () => blocking.disconnect(),
        };
      },
    },
    internal,
    ...(redis
      ? {
          uiActions: {
            ...credentials,
            langy: () => langy,
            redis: () => redis as unknown as UiActionRedis,
            actions: () => ApiWorkbenchUiActionCatalog.create(),
            backendRunner: (args) => {
              const peer = options.workbench?.();
              // No workbench composed: the channel refuses by name one layer
              // down rather than answering an away page with a silent no-op.
              if (!peer) throw new LangyUiNoBrowserError(args.kind);
              return LangyUiActionBackendService.create({
                backend: ApiWorkbenchUiActionBackend.create(peer),
              }).run(args);
            },
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
 * The local-control door, over the ONE runtime this process composed. The
 * panel's own procedures read the same one: two runtimes over process memory
 * would answer two different folders for one conversation.
 */
function composeLocal(input: {
  options: ApiLangyRestOptions;
  credentials: LangyRestCredentialPorts;
  langy: LangyApp;
}): LangyLocalRestPorts | undefined {
  const local = input.options.local;
  if (!local) return undefined;

  return {
    ...input.credentials,
    langy: () => input.langy,
    runtime: () => local.runtime,
    commands: () => local.commands,
    users: () => local.users,
    github: () => local.github,
    baseHost: local.baseHost,
    skipGate: ({ projectId, model }) =>
      SkipPermissionsService.canModelSkipPermissions({
        projectId,
        model,
        providerRows: local.providerRows,
      }),
  };
}

/**
 * The Langy counters, on the process-global Prometheus registry.
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
