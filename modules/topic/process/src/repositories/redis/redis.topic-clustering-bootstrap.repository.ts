import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import type { TopicClusteringCommands } from "../../app/topic.members.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:topic-clustering:bootstrap-gate");

// How long one project's bootstrap claim survives; healing latency for a project whose
// clustering schedule went missing; at most one process-manager commit per project per hour.
export const BOOTSTRAP_CLAIM_TTL_SECONDS = 60 * 60;

function buildKey(projectId: string): string {
  return `topic-clustering:bootstrap-claimed:${projectId}`;
}

// Rate-limits bootstrap so it can be called on every ingest without per-trace write;
// level-triggered so the system re-asserts the schedule and heals itself.
export class RedisTopicClusteringBootstrapRepository {
  private constructor(
    private readonly redis: Redis | Cluster,
    private readonly commands: TopicClusteringCommands,
    private readonly ttlSeconds: number,
  ) {}

  static create(options: {
    redis: Redis | Cluster;
    commands: TopicClusteringCommands;
    ttlSeconds?: number;
  }): RedisTopicClusteringBootstrapRepository {
    return new RedisTopicClusteringBootstrapRepository(
      options.redis,
      options.commands,
      options.ttlSeconds ?? BOOTSTRAP_CLAIM_TTL_SECONDS,
    );
  }

  async claimAndBootstrap(projectId: string): Promise<void> {
    let claimed = true;
    try {
      const result = await this.redis.set(buildKey(projectId), "1", "EX", this.ttlSeconds, "NX");
      claimed = result === "OK";
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Bootstrap claim failed; requesting anyway rather than risking an unscheduled project",
      );
    }

    if (!claimed) return;

    await this.commands.requestClustering({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      trigger: "bootstrap",
    });
  }
}
