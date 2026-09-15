import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";
import { LangyAnalyticsEventClickHouseRepository } from "./repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
import type { LangyAnalyticsClickHouseClientResolver } from "./repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
import { langyRepositories } from "./repositories/langy-repositories.registry.ts";
import { PrismaLangySessionKeyReapRepository } from "./repositories/prisma/prisma.langy-session-key-reap.repository.ts";
import type { PrismaLangySessionKeyReapDatabase } from "./repositories/prisma/prisma.langy-session-key-reap.repository.ts";
import {
  EventingLangyConversationAdapter,
  type EventingLangyConversationAdapterOptions,
} from "./repositories/redis/redis.langy-conversation-runtime.repository.ts";
import { LangyTokenBufferRedisRepository } from "./repositories/redis/redis.langy-token-buffer.repository.ts";
import {
  LangyTurnHandoffRedisRepository,
  type LangyHandoffRedis,
} from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
import { LangyRestCallerService } from "./services/langy-rest-caller.service.ts";
import { LangySessionKeyReapService } from "./services/langy-session-key-reap.service.ts";
import {
  LangyTitleGeneratorService,
  type LangyTitleGeneratorDeps,
} from "./services/langy-title-generator.service.ts";
import { langyRestPrometheusMetrics } from "./services/prometheus.langy-rest-metrics.service.ts";
import {
  langyInternalMetrics,
  langyRelayFrameMetrics,
  langyRelayLiveBuffer,
} from "./transport/langy-internal.rest.ts";
import { langyTurnsMembers, langyTurnsRest } from "./transport/langy-turns.rest.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";
import type { LangyTitleGenerator } from "./app/langy.members.ts";
import type { LangySessionKeyMetrics } from "./app/langy.members.ts";

export type { LangyInfrastructure } from "./app/langy.members.ts";

// The seams below are process-graph factories: a composing worker calls one of these
// instead of naming the feature's private repository/service classes directly (the
// private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).

/** The content-free analytics sink, over whichever ClickHouse client a project resolves to. */
export function createLangyAnalyticsEventClickHouseSink(
  resolveClient: LangyAnalyticsClickHouseClientResolver,
): LangyAnalyticsEventClickHouseRepository {
  return LangyAnalyticsEventClickHouseRepository.create(resolveClient);
}

/** Langy's conversation pipeline and the worker-facing capability that composes it. */
export function createEventingLangyConversationAdapter(
  options: EventingLangyConversationAdapterOptions,
): EventingLangyConversationAdapter {
  return EventingLangyConversationAdapter.create(options);
}

/** The turn's live-edge token buffer, over the process's own Redis connection. */
export function createLangyTokenBufferRedisRepository(deps: {
  redis: unknown;
  blockingRedis?: unknown;
}): LangyTokenBufferRedisRepository {
  return LangyTokenBufferRedisRepository.create(deps);
}

/** Where a stopped turn's handoff parks until the next agent picks it up. */
export function createLangyTurnHandoffRedisRepository(options: {
  redis: LangyHandoffRedis;
}): LangyTurnHandoffRedisRepository {
  return LangyTurnHandoffRedisRepository.create(options);
}

/** The generator as the conversation runtime's effect ports take it, bound to one model gateway. */
export function createLangyTitleGenerator(deps: LangyTitleGeneratorDeps): LangyTitleGenerator {
  return LangyTitleGeneratorService.create(deps).generator();
}

/** The daily best-effort sweep for elapsed Langy session keys, over one project database and
 * one metrics sink. */
export function createLangySessionKeyReap(options: {
  database: PrismaLangySessionKeyReapDatabase;
  metrics: LangySessionKeyMetrics;
}): LangySessionKeyReapService {
  return LangySessionKeyReapService.create({
    repository: PrismaLangySessionKeyReapRepository.create(options.database),
    metrics: options.metrics,
  });
}

// `langy.*` and `langyEgress.*` still name the deleted tRPC builder and are
// not listed here yet; the UI-action, local and local-control REST families
// are unconverted too. See the langy lane's report for state.
export const langyServer = defineServerModule("langy")
  .withRepositories(langyRepositories)
  .withApp(LangyApp)
  .withTransports(langyTurnsRest, setupSkillsTrpcTransport)
  /** Binds internal facts that langyInternalRest doesn't mount yet; the family's mount
   * refuses boot until they're bound, and moving them would only shift the same lines later. */
  .withTransportFacts(({ dependencies, members }) => {
    // Rollout gate then identity bridge, in that order - the chain both public
    // Langy families share. `actors` is the same user directory the deleted
    // `apps/api` mount passed straight through (`actors: prisma`).
    const callers = LangyRestCallerService.create({
      featureFlags: dependencies.featureFlags,
      actors: members.prisma,
    });
    const metrics = langyRestPrometheusMetrics();

    return [
      bindRestMiddleware(langyTurnsMembers, () => ({
        callers,
        // One `Prefer: wait` hold borrows a dedicated connection for its
        // blocking read and gives it back on release, so a held request never
        // takes the shared connection out of service for everything else.
        openTurnBuffer: () => {
          const blocking = members.redis.duplicate();

          return {
            buffer: LangyTokenBufferRedisRepository.create({
              redis: members.redis,
              blockingRedis: blocking,
            }),
            release: () => blocking.disconnect(),
          };
        },
      })),
      bindRestMiddleware(langyInternalMetrics, () => metrics.internal),
      bindRestMiddleware(langyRelayFrameMetrics, () => metrics.relayFrames),
      // `LangyApp.reads` claims `redis`, so a process that installed this
      // module HAS the live edge: there is no composition in which the relay
      // is mounted over a buffer that does not exist.
      bindRestMiddleware(langyRelayLiveBuffer, () => true),
    ];
  });
