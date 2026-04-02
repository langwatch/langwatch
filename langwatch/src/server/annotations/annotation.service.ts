import type { Annotation, PrismaClient } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";
import {
  AnnotationRepository,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type UpdateAnnotationInput,
} from "./annotation.repository";
import { AnnotationEsSync } from "./annotationEsSync";

type Logger = ReturnType<typeof createLogger>;

/**
 * Service layer for annotation business logic.
 * Single Responsibility: Annotation lifecycle management and ES sync coordination.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class AnnotationService {
  constructor(
    private readonly repository: AnnotationRepository,
    private readonly esSync: AnnotationEsSync | null,
    private readonly logger: Logger,
  ) {}

  /**
   * Static factory method for creating an AnnotationService with proper DI.
   *
   * ES writes are globally disabled (ClickHouse is the primary store),
   * so `esSync` is always `null`.
   */
  static async create({
    prisma,
    projectId: _projectId,
  }: {
    prisma: PrismaClient;
    projectId: string;
  }): Promise<AnnotationService> {
    const repository = new AnnotationRepository(prisma);
    const logger = createLogger("langwatch:annotations:service");
    const esSync: AnnotationEsSync | null = null;

    return new AnnotationService(repository, esSync, logger);
  }

  /**
   * Creates a new annotation and syncs to Elasticsearch if enabled.
   * ES failures are logged but never prevent the annotation from being created.
   */
  async create(input: CreateAnnotationInput): Promise<Annotation> {
    const annotation = await this.repository.create(input);

    if (this.esSync) {
      try {
        await this.esSync.syncAfterCreate(input.traceId, input.projectId);
      } catch (error) {
        this.logger.error(
          { error, traceId: input.traceId, projectId: input.projectId },
          "Failed to update Elasticsearch after annotation creation",
        );
      }
    }

    return annotation;
  }

  /**
   * Updates an existing annotation.
   * No ES sync needed — updates don't change annotation count on the trace.
   */
  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(input);
  }

  /**
   * Deletes an annotation by id and syncs the removal to Elasticsearch if enabled.
   * ES failures are logged but never prevent the annotation from being deleted.
   */
  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    const annotation = await this.repository.delete(input);

    if (this.esSync) {
      try {
        await this.esSync.syncAfterDelete(
          annotation.traceId,
          input.projectId,
        );
      } catch (error) {
        this.logger.error(
          {
            error,
            traceId: annotation.traceId,
            projectId: input.projectId,
          },
          "Failed to update Elasticsearch after annotation deletion",
        );
      }
    }

    return annotation;
  }
}
