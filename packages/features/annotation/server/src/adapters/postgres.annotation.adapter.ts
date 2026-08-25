import type { AnnotationService as AnnotationServiceContract } from "@langwatch/annotation-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { PrismaAnnotationRepository } from "../repositories/prisma/prisma.annotation.repository";
import { AnnotationService } from "../services/annotation.service";

export interface PostgresAnnotationAdapterOptions {
  database: PrismaClient;
  projects: ProjectService;
  organizations: OrganizationService;
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
      projects: this.options.projects,
      organizations: this.options.organizations,
    });
  }
}
