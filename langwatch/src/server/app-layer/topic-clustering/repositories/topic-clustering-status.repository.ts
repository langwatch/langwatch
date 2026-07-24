import type { Prisma, PrismaClient } from "@prisma/client";

import { TOPIC_CLUSTERING_PROCESS_NAME } from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringProcess.types";
import type { TopicClusteringRunHistoryEntry } from "~/server/event-sourcing/pipelines/topic-clustering-processing/projections/topicClusteringRunHistory.foldProjection";

import { parseRunHistoryRuns } from "./topic-clustering-run-history-projection.prisma.repository";

export type TopicClusteringRunProjectionRow =
  Prisma.TopicClusteringRunProjectionGetPayload<object>;

export interface TopicClusteringStatusRecord {
  projection: TopicClusteringRunProjectionRow | null;
  /** The process's scheduled daily wake, or null when not yet bootstrapped. */
  nextWakeAt: Date | null;
}

export interface TopicClusteringStatusRepository {
  findByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringStatusRecord>;
  findRunHistoryByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringRunHistoryEntry[]>;
}

/**
 * Read side of ADR-051 §7: run facts come from the rebuildable projection;
 * "next run at" comes from the process instance's nextWakeAt column — the
 * sole authority on scheduling intent. The process state JSON itself is
 * private decision memory and is deliberately never read here.
 */
export class PrismaTopicClusteringStatusRepository
  implements TopicClusteringStatusRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringStatusRecord> {
    const { projectId } = params;
    const [projection, instance] = await Promise.all([
      this.prisma.topicClusteringRunProjection.findUnique({
        where: { projectId },
      }),
      this.prisma.processManagerInstance.findUnique({
        where: {
          // The bare projectId satisfies the tenancy guard (same pattern as
          // PrismaProcessStore); the compound key is the actual selector.
          projectId,
          processName_projectId_processKey: {
            processName: TOPIC_CLUSTERING_PROCESS_NAME,
            projectId,
            processKey: projectId,
          },
        },
        select: { nextWakeAt: true },
      }),
    ]);
    return {
      projection,
      nextWakeAt: instance?.nextWakeAt ?? null,
    };
  }

  async findRunHistoryByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringRunHistoryEntry[]> {
    const row = await this.prisma.topicClusteringRunHistoryProjection.findUnique(
      { where: { projectId: params.projectId } },
    );
    return row ? parseRunHistoryRuns(row.Runs) : [];
  }
}
