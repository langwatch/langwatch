import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { TopicClusteringClaimRepository } from "../repositories/topic-clustering-claim.repository.ts";
import type { EventingTopicClusteringCommandsService } from "./topic-clustering-commands.service.ts";

const logger = createLogger("langwatch:topic-clustering:bootstrap-gate");

// How long one project's bootstrap claim survives; healing latency for a project whose
// clustering schedule went missing; at most one process-manager commit per project per hour.
export const BOOTSTRAP_CLAIM_TTL_SECONDS = 60 * 60;

// Rate-limits bootstrap so it can be called on every ingest without per-trace write;
// level-triggered so the system re-asserts the schedule and heals itself.
export class TopicClusteringBootstrapService {
  private constructor(
    private readonly claims: TopicClusteringClaimRepository,
    private readonly commands: Pick<EventingTopicClusteringCommandsService, "requestClustering">,
  ) {}

  static create(options: {
    claims: TopicClusteringClaimRepository;
    commands: Pick<EventingTopicClusteringCommandsService, "requestClustering">;
  }): TopicClusteringBootstrapService {
    return new TopicClusteringBootstrapService(options.claims, options.commands);
  }

  async bootstrap(input: { projectId: string }): Promise<void> {
    let claimed = true;
    try {
      claimed = await this.claims.claim({
        key: `topic-clustering:bootstrap-claimed:${input.projectId}`,
        ttlSeconds: BOOTSTRAP_CLAIM_TTL_SECONDS,
      });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, error },
        "Bootstrap claim failed; requesting anyway rather than risking an unscheduled project",
      );
    }

    if (!claimed) return;

    await this.commands.requestClustering({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      trigger: "bootstrap",
    });
  }
}
