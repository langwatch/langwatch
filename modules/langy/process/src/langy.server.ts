import { bindRestMiddleware, bindRestCredential } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { LangyApp } from "./app/langy.app.ts";
import type { LangyTitleGenerator, LangySessionKeyMetrics } from "./app/langy.members.ts";
import { langyMaintenanceEventing } from "./eventing/langy-maintenance.pipeline.ts";
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
import { LangySessionKeyReapService } from "./services/langy-session-key-reap.service.ts";
import {
  LangyTitleGeneratorService,
  type LangyTitleGeneratorDeps,
} from "./services/langy-title-generator.service.ts";
import { langyInternalRest } from "./transport/langy-internal.rest.ts";
import { langyLocalRest } from "./transport/langy-local.rest.ts";
import { langyTurnsMembers, langyTurnsRest } from "./transport/langy-turns.rest.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";

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
// not listed here yet; the UI-action and local-control REST families are
// unconverted too. See .claude/handoffs/port-langy-routes.md for state.
export const langyServer = defineServerModule("langy")
  .withRepositories(langyRepositories)
  .withApp(LangyApp)
  .withTransports(langyTurnsRest, langyInternalRest, langyLocalRest, setupSkillsTrpcTransport)
  .withTransportFacts(({ app, members }) => {
    if (!(app instanceof LangyApp))
      throw new TypeError("Langy transport requires its constructed application");
    return [
      bindRestCredential("internalSecret", () => app.internalDoor),
      bindRestMiddleware(langyTurnsMembers, () => ({
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
    ];
  })
  .withEventing(langyMaintenanceEventing);
