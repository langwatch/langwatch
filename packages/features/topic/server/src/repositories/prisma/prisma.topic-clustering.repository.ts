import { CostReferenceType, CostType, type PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "../../processes/topic-clustering.process";
import {
  TopicClusteringRepository,
  type TopicClusteringModelRow,
  type TopicClusteringSeedTopicRow,
  type TopicClusteringTopicIndexRow,
} from "../topic-clustering.repository";

/** Prisma-backed {@link TopicClusteringRepository}. */
export class PrismaTopicClusteringRepository extends TopicClusteringRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(options: { database: PrismaClient }): PrismaTopicClusteringRepository {
    return new PrismaTopicClusteringRepository(options.database);
  }

  async tryFindProject(projectId: string): Promise<{ id: string } | null> {
    return this.prisma.project.findUnique({ where: { id: projectId } });
  }

  async findTopicIndexRows(projectId: string): Promise<TopicClusteringTopicIndexRow[]> {
    return this.prisma.topic.findMany({
      where: { projectId },
      select: { id: true, parentId: true, createdAt: true },
    });
  }

  async findModelTopics(projectId: string): Promise<TopicClusteringModelRow[]> {
    const rows = await this.prisma.topic.findMany({
      where: { projectId, parentId: null },
      select: { id: true, name: true, centroid: true, p95Distance: true },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      centroid: row.centroid as number[],
      p95Distance: row.p95Distance,
      parentId: null,
    }));
  }

  async findModelSubtopics(projectId: string): Promise<TopicClusteringModelRow[]> {
    const rows = await this.prisma.topic.findMany({
      where: { projectId, parentId: { not: null } },
      select: { id: true, name: true, centroid: true, p95Distance: true, parentId: true },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      centroid: row.centroid as number[],
      p95Distance: row.p95Distance,
      parentId: row.parentId,
    }));
  }

  async recordClusteringCost(params: {
    projectId: string;
    amount: number;
    currency: "USD" | "EUR";
    tracesCount: number;
    topicsCount: number;
    subtopicsCount: number;
    isIncremental: boolean;
  }): Promise<void> {
    await this.prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: params.projectId,
        costType: CostType.CLUSTERING,
        costName: "Topics Clustering",
        referenceType: CostReferenceType.PROJECT,
        referenceId: params.projectId,
        amount: params.amount,
        currency: params.currency,
        extraInfo: {
          traces_count: params.tracesCount,
          topics_count: params.topicsCount,
          subtopics_count: params.subtopicsCount,
          is_incremental: params.isIncremental,
        },
      },
    });
  }

  async tryFindTopicModelCursor(projectId: string): Promise<{ id: string } | null> {
    return this.prisma.topicModelProjection.findUnique({
      where: { projectId },
      select: { id: true },
    });
  }

  async findSeedTopicRows(projectId: string): Promise<TopicClusteringSeedTopicRow[]> {
    const rows = await this.prisma.topic.findMany({
      where: { projectId },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      embeddingsModel: row.embeddings_model,
      centroid: row.centroid as number[],
      p95Distance: row.p95Distance,
      automaticallyGenerated: row.automaticallyGenerated,
      createdAt: row.createdAt,
    }));
  }

  async findProjectsWithTopicsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]> {
    return this.prisma.project.findMany({
      where: {
        topics: { some: {} },
        ...(params.afterId ? { id: { gt: params.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: params.take,
    });
  }

  async findEligibleProjectsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]> {
    return this.prisma.project.findMany({
      where: {
        firstMessage: true,
        ...(params.afterId ? { id: { gt: params.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: params.take,
    });
  }

  async findOwnedTopicModelProjectIds(projectIds: string[]): Promise<string[]> {
    const rows = await this.prisma.topicModelProjection.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true },
    });
    return rows.map((row) => row.projectId);
  }

  async findAlreadyScheduledProjectIds(projectIds: string[]): Promise<string[]> {
    // Bounded by `projectId: { in }`, which the tenancy guard accepts.
    const instances = await this.prisma.processManagerInstance.findMany({
      where: {
        processName: TOPIC_CLUSTERING_PROCESS_NAME,
        projectId: { in: projectIds },
        nextWakeAt: { not: null },
      },
      select: { projectId: true },
    });
    return instances.map((instance) => instance.projectId);
  }
}
