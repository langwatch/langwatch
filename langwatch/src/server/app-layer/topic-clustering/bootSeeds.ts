import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";

import { TOPIC_CLUSTERING_PROCESS_NAME } from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringProcess.types";
import {
  seedClusteringSchedules,
  type BackfillDeps,
} from "./seedClusteringSchedules";
import {
  seedTopicModelHistory,
  type RecordTopicsSeedCommand,
} from "./seedTopicModel";

export interface TopicClusteringBootSeedCommands {
  recordTopics: RecordTopicsSeedCommand;
  requestClustering: (args: {
    tenantId: string;
    occurredAt: number;
    trigger: "bootstrap";
  }) => Promise<void>;
}

export interface TopicClusteringBootSeedDeps {
  prisma: PrismaClient;
  /** Coordination only — without Redis both seeds still run safely. */
  redis: Redis | Cluster | null;
  commands: TopicClusteringBootSeedCommands;
}

/**
 * Prisma-backed ports for the schedule-seed walk. `Project` is a GLOBAL
 * model in the tenancy guard (it IS the tenant, addressed by its own id),
 * so the fleet-wide page query carries no projectId predicate by design;
 * the ProcessManagerInstance lookup is bounded by `projectId: { in }`,
 * which the guard accepts.
 */
export function prismaScheduleSeedPorts(
  prisma: PrismaClient,
): Pick<
  BackfillDeps,
  "findEligibleProjectsPage" | "findAlreadyScheduledProjectIds"
> {
  return {
    findEligibleProjectsPage: ({ afterId, take }) =>
      prisma.project.findMany({
        where: {
          firstMessage: true,
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take,
      }),
    findAlreadyScheduledProjectIds: async ({ projectIds }) => {
      const instances = await prisma.processManagerInstance.findMany({
        where: {
          processName: TOPIC_CLUSTERING_PROCESS_NAME,
          projectId: { in: projectIds },
          nextWakeAt: { not: null },
        },
        select: { projectId: true },
      });
      return new Set(instances.map((instance) => instance.projectId));
    },
  };
}

/**
 * Fires both one-time topic-clustering boot seeds in the background on
 * worker start (never a deploy-time job — see ADR-051):
 *
 * - the topic MODEL seed, which records pre-ownership Topic rows onto each
 *   project's clustering stream so the event log owns the model, and
 * - the SCHEDULE seed, which gives every pre-cutover project a scheduled
 *   daily wake.
 *
 * Redis elects one replica per window for each; both are idempotent
 * without it. Failures are logged and the next boot retries — nothing here
 * may take the boot down, so this returns immediately and never throws.
 */
export function startTopicClusteringBootSeeds(
  deps: TopicClusteringBootSeedDeps,
): void {
  void seedTopicModelHistory({
    prisma: deps.prisma,
    redis: deps.redis,
    recordTopics: deps.commands.recordTopics,
  }).catch((error: unknown) => {
    createLogger("langwatch:topic-clustering:seed").error(
      { error: error instanceof Error ? error.message : String(error) },
      "Topic model seed pass failed; the next boot retries",
    );
  });

  void seedClusteringSchedules({
    redis: deps.redis,
    ...prismaScheduleSeedPorts(deps.prisma),
    requestClustering: async ({ projectId }) => {
      await deps.commands.requestClustering({
        tenantId: projectId,
        occurredAt: Date.now(),
        trigger: "bootstrap",
      });
    },
  }).catch((error: unknown) => {
    createLogger("langwatch:topic-clustering:schedule-seed").error(
      { error: error instanceof Error ? error.message : String(error) },
      "Topic clustering schedule seed failed; the next boot retries",
    );
  });
}
