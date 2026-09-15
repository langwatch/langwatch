import {
  AnnotationQueueNotFoundError,
  type AnnotationQueueRecord,
  type AnnotationQueueListEntry,
  type AnnotationQueueDetail,
} from "@langwatch/annotation-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { isRecordNotFoundError } from "@langwatch/prisma-client/errors";
import type {
  AnnotationQueueRepository,
  QueueByIdInput,
  QueueBySlugInput,
  QueueCountInput,
  QueueCreateInput,
  QueueUpdateInput,
  QueueListInput,
  QueueSlugInput,
} from "../annotation-queue.repository.ts";

const queueMemberInclude = (organizationId: string) => ({
  where: { user: { orgMemberships: { some: { organizationId } } } },
  select: { user: { select: { id: true, name: true, image: true } } },
});

const queueScoreInclude = (projectId: string) => ({
  where: { annotationScore: { projectId } },
  select: { annotationScore: { select: { id: true, name: true } } },
});

export class PrismaAnnotationQueueRepository
  extends PrismaRepository.for("AnnotationQueue", "AnnotationQueueMembers", "AnnotationQueueScores")
  implements AnnotationQueueRepository
{
  static readonly create = this.factory((prisma) => new PrismaAnnotationQueueRepository(prisma));

  async countQueues({ projectId, queueIds }: QueueCountInput): Promise<number> {
    if (queueIds.length === 0) return 0;

    return this.prisma.annotationQueue.count({
      where: { projectId, id: { in: [...queueIds] } },
    });
  }

  async queueSlugExists({ projectId, slug }: QueueSlugInput): Promise<boolean> {
    const queue = await this.prisma.annotationQueue.findFirst({ where: { projectId, slug } });

    return queue !== null;
  }

  async createQueue({
    projectId,
    name,
    slug,
    description,
    userIds,
    scoreTypeIds,
  }: QueueCreateInput): Promise<AnnotationQueueRecord> {
    const queue = await this.prisma.annotationQueue.create({
      data: {
        projectId,
        name,
        slug,
        description,
        members: { create: userIds.map((userId) => ({ userId })) },
        AnnotationQueueScores: {
          create: scoreTypeIds.map((annotationScoreId) => ({ annotationScoreId })),
        },
      },
    });

    return queue;
  }

  async updateQueue({
    projectId,
    queueId,
    name,
    slug,
    description,
    userIds,
    scoreTypeIds,
  }: QueueUpdateInput): Promise<AnnotationQueueRecord> {
    try {
      return await this.prisma.annotationQueue.update({
        where: { id: queueId, projectId },
        data: {
          projectId,
          name,
          slug,
          description,
          members: { deleteMany: {}, create: userIds.map((userId) => ({ userId })) },
          AnnotationQueueScores: {
            deleteMany: {},
            create: scoreTypeIds.map((annotationScoreId) => ({ annotationScoreId })),
          },
        },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationQueueNotFoundError(queueId);

      throw error;
    }
  }

  async listQueues({
    projectId,
    reachableOnly,
    userId,
  }: QueueListInput): Promise<AnnotationQueueListEntry[]> {
    const where: Prisma.AnnotationQueueWhereInput = { projectId };

    if (reachableOnly && userId !== void 0) {
      where.OR = [
        { members: { some: { userId } } },
        { AnnotationQueueItems: { some: { userId } } },
      ];
    }

    const queues = await this.prisma.annotationQueue.findMany({
      where,
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "desc" },
    });

    return queues;
  }

  async getQueueById(input: QueueByIdInput): Promise<AnnotationQueueDetail> {
    const queue = await this.prisma.annotationQueue.findUnique({
      where: { id: input.queueId, projectId: input.projectId },
      include: {
        members: queueMemberInclude(input.organizationId),
        AnnotationQueueScores: queueScoreInclude(input.projectId),
      },
    });

    if (!queue) throw new AnnotationQueueNotFoundError(input.queueId);

    return queue;
  }

  async getQueueBySlug(input: QueueBySlugInput): Promise<AnnotationQueueDetail> {
    const queue = await this.prisma.annotationQueue.findUnique({
      where: { projectId_slug: { projectId: input.projectId, slug: input.slug } },
      include: {
        members: queueMemberInclude(input.organizationId),
        AnnotationQueueScores: queueScoreInclude(input.projectId),
      },
    });

    if (!queue) throw new AnnotationQueueNotFoundError(input.slug);

    return queue;
  }
}
