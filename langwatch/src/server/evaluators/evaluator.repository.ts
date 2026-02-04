import type { Evaluator, Prisma, PrismaClient } from "@prisma/client";
import { generateEvaluatorSlug } from "../../utils/evaluatorSlug";

/**
 * Input type for creating an evaluator
 */
export type CreateEvaluatorInput = {
  id: string;
  projectId: string;
  name: string;
  slug?: string; // Auto-generated from name if not provided
  type: string; // "evaluator" (built-in) | "workflow" (custom)
  config: Prisma.InputJsonValue;
  workflowId?: string;
  copiedFromEvaluatorId?: string;
};

/**
 * Input type for updating an evaluator
 */
export type UpdateEvaluatorInput = {
  id: string;
  projectId: string;
  data: Partial<{
    name: string;
    type: string;
    config: Prisma.InputJsonValue;
    workflowId: string | null;
  }>;
};

/**
 * Repository layer for Evaluator data access.
 * Single Responsibility: Database operations for evaluators.
 */
export class EvaluatorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds a single evaluator by id within a project.
   * Excludes archived evaluators by default.
   */
  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    return await this.prisma.evaluator.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
    });
  }

  /**
   * Finds all evaluators for a project with copy-count for replica UI.
   * Excludes archived evaluators. Orders by most recently updated.
   */
  async findAll(input: {
    projectId: string;
  }): Promise<(Evaluator & { _count: { copiedEvaluators: number } })[]> {
    return await this.prisma.evaluator.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        _count: { select: { copiedEvaluators: true } },
      },
    });
  }

  /**
   * Finds a single evaluator by slug within a project.
   * Excludes archived evaluators by default.
   */
  async findBySlug(input: {
    slug: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    return await this.prisma.evaluator.findFirst({
      where: {
        slug: input.slug,
        projectId: input.projectId,
        archivedAt: null,
      },
    });
  }

  /**
   * Creates a new evaluator.
   * Auto-generates a slug from the name if not provided.
   * Retries with a new nanoid suffix on unique constraint violation.
   */
  async create(input: CreateEvaluatorInput): Promise<Evaluator> {
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const slug = input.slug ?? generateEvaluatorSlug(input.name);
      try {
        return await this.prisma.evaluator.create({
          data: {
            ...input,
            slug,
          },
        });
      } catch (error) {
        // Check if it's a unique constraint violation on slug
        if (
          error instanceof Error &&
          error.message.includes("Unique constraint") &&
          error.message.includes("slug")
        ) {
          lastError = error;
          // Retry with a new slug (don't use input.slug on retry)
          input = { ...input, slug: undefined };
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Updates an existing evaluator.
   * Validates that the evaluator belongs to the specified project.
   */
  async update(input: UpdateEvaluatorInput): Promise<Evaluator> {
    return await this.prisma.evaluator.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Soft deletes an evaluator by setting archivedAt.
   */
  async softDelete(input: {
    id: string;
    projectId: string;
  }): Promise<Evaluator> {
    return await this.prisma.evaluator.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: {
        archivedAt: new Date(),
      },
    });
  }
}
