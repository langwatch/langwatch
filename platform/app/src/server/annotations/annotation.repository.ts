import type { Annotation, PrismaClient } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import {
  type AnnotationAnchorKind,
  type AnnotationAnchorScope,
  annotationAnchorScopeWhere,
} from "./annotationAnchor";

export type CreateAnnotationInput = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string;
  comment: string;
  isThumbsUp: boolean | null;
  scoreOptions: JsonValue;
  expectedOutput: string | null;
  /**
   * Which part of the trace the comment is about. Absent means the trace as a
   * whole. Fixed when the comment is written: there is no way to move a comment
   * to another part of the trace, so a card can never quietly start describing
   * something other than what its author read.
   */
  anchorKind?: AnnotationAnchorKind | null;
  anchorId?: string | null;
  anchorPath?: string | null;
};

export type UpdateAnnotationInput = {
  id: string;
  projectId: string;
  traceId: string;
  comment: string;
  isThumbsUp: boolean | null | undefined;
  scoreOptions: JsonValue;
  /**
   * The suggested output. Omitted when the save did not carry the field at
   * all, which leaves the stored suggestion alone; `null` withdraws it.
   */
  expectedOutput: string | null | undefined;
};

export type DeleteAnnotationInput = {
  id: string;
  projectId: string;
};

/**
 * One annotation as the trace projections read it: the fields the projection
 * DSL exposes and nothing heavier.
 */
export type ProjectionAnnotationRow = {
  id: string;
  traceId: string;
  isThumbsUp: boolean | null;
  comment: string | null;
  expectedOutput: string | null;
  scoreOptions: JsonValue;
  createdAt: Date;
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
        anchorKind: input.anchorKind ?? null,
        anchorId: input.anchorId ?? null,
        anchorPath: input.anchorPath ?? null,
      },
    });
  }

  /**
   * Annotations for a page of traces as the trace projections read them.
   * `anchorScope` decides whether a comment left on one part of a trace counts:
   * the projections feed the trace table, the export and the dataset columns,
   * all of which answer questions about whole traces.
   */
  async findAllForProjection({
    projectId,
    traceIds,
    anchorScope,
  }: {
    projectId: string;
    traceIds: string[];
    anchorScope: AnnotationAnchorScope;
  }): Promise<ProjectionAnnotationRow[]> {
    return await this.prisma.annotation.findMany({
      where: {
        projectId,
        traceId: { in: traceIds },
        ...annotationAnchorScopeWhere(anchorScope),
      },
      select: {
        id: true,
        traceId: true,
        isThumbsUp: true,
        comment: true,
        expectedOutput: true,
        scoreOptions: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
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
