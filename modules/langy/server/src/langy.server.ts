import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";
import { langyRepositories } from "./repositories/langy-repositories.registry.ts";
import { LangyTokenBufferRedisRepository } from "./repositories/redis/redis.langy-token-buffer.repository.ts";
import { LangyRestCallerService } from "./services/langy-rest-caller.service.ts";
import { langyRestPrometheusMetrics } from "./services/prometheus.langy-rest-metrics.service.ts";
import {
  langyInternalMetrics,
  langyRelayFrameMetrics,
  langyRelayLiveBuffer,
} from "./transport/langy-internal.rest.ts";
import { langyTurnsMembers, langyTurnsRest } from "./transport/langy-turns.rest.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";

export type { LangyInfrastructure } from "./app/langy.app.ts";

// `langy.*` and `langyEgress.*` still name the deleted tRPC builder and are
// not listed here yet; the UI-action, local and local-control REST families
// are unconverted too. See the langy lane's report for state.
export const langyServer = defineServerModule("langy")
  .withRepositories(langyRepositories)
  .withApp(LangyApp)
  .withTransports(langyTurnsRest, setupSkillsTrpcTransport)
  /**
   * What the public turn surface and the internal control plane reach that
   * Langy's own application does not own, resolved once per install from the
   * peers the App declared and the members it reads.
   *
   * `langyInternalRest` is not in `withTransports` yet, so the three facts
   * below bind nothing this process currently mounts. They are bound anyway:
   * the family's mount is a boot refusal until they are, and every value here
   * is this module's to state, so leaving them unbound would only move the
   * same three lines into whichever process lists the family next.
   */
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
