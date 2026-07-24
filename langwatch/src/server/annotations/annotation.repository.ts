import type { Annotation, PrismaClient } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";

export type CreateAnnotationInput = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string;
  comment: string;
  isThumbsUp: boolean | null;
  scoreOptions: JsonValue;
  expectedOutput: string | null;
};

export type UpdateAnnotationInput = {
  id: string;
  projectId: string;
  traceId: string;
  comment: string;
  isThumbsUp: boolean | null | undefined;
  scoreOptions: JsonValue;
  expectedOutput: string | null;
};

export type DeleteAnnotationInput = {
  id: string;
  projectId: string;
};

/**
 * Repository layer for annotation data access.
 * Single Responsibility: Database operations for annotations.
 */
export class AnnotationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new annotation.
   */
  async create(input: CreateAnnotationInput): Promise<Annotation> {
    return await this.prisma.annotation.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        traceId: input.traceId,
        userId: input.userId,
        comment: input.comment,
        isThumbsUp: input.isThumbsUp,
        scoreOptions: input.scoreOptions ?? {},
        expectedOutput: input.expectedOutput,
      },
    });
  }

  /**
   * Updates an existing annotation.
   */
  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    return await this.prisma.annotation.update({
      where: {
        id: input.id,
        projectId: input.projectId,
        traceId: input.traceId,
      },
      data: {
        comment: input.comment,
        isThumbsUp: input.isThumbsUp,
        scoreOptions: input.scoreOptions ?? {},
        expectedOutput: input.expectedOutput,
      },
    });
  }

  /**
   * Deletes an annotation by id within a project.
   */
  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return await this.prisma.annotation.delete({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Resolves the organization that owns a project, or null when the project
   * does not exist.
   */
  async findProjectOrganizationId({
    projectId,
  }: {
    projectId: string;
  }): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });

    return project?.team.organizationId ?? null;
  }

  /**
   * Counts how many of the given users belong to the organization.
   */
  async countOrganizationUsers({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<number> {
    if (userIds.length === 0) return 0;

    return await this.prisma.organizationUser.count({
      where: { organizationId, userId: { in: userIds } },
    });
  }

  /**
   * Counts how many of the given annotation scores belong to the project.
   */
  async countAnnotationScores({
    projectId,
    scoreTypeIds,
  }: {
    projectId: string;
    scoreTypeIds: string[];
  }): Promise<number> {
    if (scoreTypeIds.length === 0) return 0;

    return await this.prisma.annotationScore.count({
      where: { projectId, id: { in: scoreTypeIds } },
    });
  }

  /**
   * Counts how many of the given annotation queues belong to the project.
   */
  async countAnnotationQueues({
    projectId,
    queueIds,
  }: {
    projectId: string;
    queueIds: string[];
  }): Promise<number> {
    if (queueIds.length === 0) return 0;

    return await this.prisma.annotationQueue.count({
      where: { id: { in: queueIds }, projectId },
    });
  }
}
