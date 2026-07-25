import type { Annotation, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  AnnotationRepository,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type UpdateAnnotationInput,
} from "./annotation.repository";

export class AnnotationService {
  constructor(private readonly repository: AnnotationRepository) {}

  static create({ prisma }: { prisma: PrismaClient }): AnnotationService {
    return new AnnotationService(new AnnotationRepository(prisma));
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.repository.create(input);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(input);
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.repository.delete(input);
  }

  async getProjectOrganizationId({
    projectId,
  }: {
    projectId: string;
  }): Promise<string> {
    const organizationId = await this.repository.findProjectOrganizationId({
      projectId,
    });

    if (organizationId === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    return organizationId;
  }

  /**
   * Guards a queue's configuration against cross-tenant references: members
   * must belong to the project's organization and scores to the project.
   */
  async assertQueueConfigurationReferences({
    projectId,
    userIds,
    scoreTypeIds,
  }: {
    projectId: string;
    userIds: string[];
    scoreTypeIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId({ projectId });
    const uniqueUserIds = [...new Set(userIds)];
    const uniqueScoreTypeIds = [...new Set(scoreTypeIds)];

    const [userCount, scoreCount] = await Promise.all([
      this.repository.countOrganizationUsers({
        organizationId,
        userIds: uniqueUserIds,
      }),
      this.repository.countAnnotationScores({
        projectId,
        scoreTypeIds: uniqueScoreTypeIds,
      }),
    ]);

    if (userCount !== uniqueUserIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more queue members are not in this organization",
      });
    }
    if (scoreCount !== uniqueScoreTypeIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more annotation scores are not in this project",
      });
    }
  }

  /**
   * Guards queue-item annotators against cross-tenant references: queues must
   * belong to the project and users to the project's organization.
   */
  async assertAnnotatorReferences({
    projectId,
    queueIds,
    userIds,
  }: {
    projectId: string;
    queueIds: string[];
    userIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId({ projectId });
    const uniqueQueueIds = [...new Set(queueIds)];
    const uniqueUserIds = [...new Set(userIds)];

    const [queueCount, userCount] = await Promise.all([
      this.repository.countAnnotationQueues({
        projectId,
        queueIds: uniqueQueueIds,
      }),
      this.repository.countOrganizationUsers({
        organizationId,
        userIds: uniqueUserIds,
      }),
    ]);

    if (
      queueCount !== uniqueQueueIds.length ||
      userCount !== uniqueUserIds.length
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more annotators are not available in this project",
      });
    }
  }
}
