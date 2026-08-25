import type { AnnotationService as AnnotationServiceContract } from "@langwatch/annotation-contract";
import { PrismaAnnotationRepository } from "../repositories/prisma/prisma.annotation.repository";
import { AnnotationService } from "../services/annotation.service";

export interface PostgresAnnotationAdapterOptions {
  database: object;
}

/** Process-owned PostgreSQL composition for the Annotation feature. */
export class PostgresAnnotationAdapter {
  private constructor(private readonly options: PostgresAnnotationAdapterOptions) {}

  static create(options: PostgresAnnotationAdapterOptions): PostgresAnnotationAdapter {
    return new PostgresAnnotationAdapter(options);
  }

  build(): AnnotationServiceContract {
    return AnnotationService.create({
      repository: PrismaAnnotationRepository.create(this.options.database),
    });
  }
}
