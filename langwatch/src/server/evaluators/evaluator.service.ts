import type { Evaluator, PrismaClient } from "@prisma/client";
import {
  type CreateEvaluatorInput,
  EvaluatorRepository,
} from "./evaluator.repository";

/**
 * Service layer for Evaluator business logic.
 * Single Responsibility: Evaluator lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class EvaluatorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: EvaluatorRepository,
  ) {}

  /**
   * Static factory method for creating an EvaluatorService with proper DI.
   */
  static create(prisma: PrismaClient): EvaluatorService {
    const repository = new EvaluatorRepository(prisma);
    return new EvaluatorService(prisma, repository);
  }

  /**
   * Gets an evaluator by ID.
   */
  get getById() {
    return this.repository.findById.bind(this.repository);
  }

  /**
   * Gets an evaluator by slug.
   */
  get getBySlug() {
    return this.repository.findBySlug.bind(this.repository);
  }

  /**
   * Gets all evaluators for a project.
   */
  get getAll() {
    return this.repository.findAll.bind(this.repository);
  }

  /**
   * Creates a new evaluator.
   */
  get create() {
    return this.repository.create.bind(this.repository);
  }

  /**
   * Updates an existing evaluator.
   */
  get update() {
    return this.repository.update.bind(this.repository);
  }

  /**
   * Soft deletes an evaluator.
   */
  get softDelete() {
    return this.repository.softDelete.bind(this.repository);
  }
}
