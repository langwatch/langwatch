import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  type EventSourcing,
  ReplayService as EventingReplayService,
  pipelineUpcastsOf,
  replayLeanOf,
  replayProjectionsOf,
  type RetentionPolicyResolver,
  upcastReplayEventSource,
} from "@langwatch/eventing";
import { EventingClickHouseReplayEventSource } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";

import type { OpsReplayRuntime } from "../../app/ops.app.ts";
import { ReplayRuntimeRepository } from "../replay-runtime.repository.ts";

/**
 * One replay run's engine over the pipelines this process registered: the event log read through
 * the routed member itself (§7), markers on a standalone Redis connection sharing no socket with
 * live traffic. A Cluster refuses replay's multi-key operations (CROSSSLOT), as on main.
 */
export class LiveReplayRuntimeRepository extends ReplayRuntimeRepository {
  private constructor(
    private readonly members: Readonly<{
      redis: RedisConnection;
      clickhouse: ClickHouseQueryClient;
      eventing: Pick<EventSourcing, "definitions">;
    }>,
  ) {
    super();
  }

  static create(members: {
    redis: RedisConnection;
    clickhouse: ClickHouseQueryClient;
    eventing: Pick<EventSourcing, "definitions">;
  }): LiveReplayRuntimeRepository {
    return new LiveReplayRuntimeRepository(members);
  }

  create({ retention }: { retention: RetentionPolicyResolver }): OpsReplayRuntime {
    const { redis, clickhouse, eventing } = this.members;
    if (redis.isCluster) {
      throw new Error(
        "Replay requires a standalone Redis: a Cluster refuses its multi-key operations.",
      );
    }
    const connection = redis.duplicate();
    const definitions = eventing.definitions;
    const service = new EventingReplayService({
      eventSource: upcastReplayEventSource({
        source: new EventingClickHouseReplayEventSource({
          clickhouse,
          lean: replayLeanOf(definitions),
        }),
        upcasts: pipelineUpcastsOf(definitions),
      }),
      redis: connection,
      retentionPolicyResolver: retention,
    });
    return {
      service,
      ...replayProjectionsOf(definitions),
      close: async () => {
        connection.disconnect();
      },
    };
  }
}
