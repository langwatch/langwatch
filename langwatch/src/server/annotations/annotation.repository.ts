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
}
