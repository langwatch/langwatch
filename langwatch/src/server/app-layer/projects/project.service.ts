import type { PrismaClient, Project } from "@prisma/client";
import { traced } from "../tracing";
import { PrismaProjectRepository } from "./repositories/project.prisma.repository";
import {
  NullProjectRepository,
  type ProjectRepository,
} from "./repositories/project.repository";

/** All boolean fields on Project whose name starts with "feature". */
export type ProjectFeatureFlag = Extract<keyof Project, `feature${string}`>;

export class ProjectService {
  private constructor(private readonly repo: ProjectRepository) {}

  static create(prisma: PrismaClient | null): ProjectService {
    const repo = prisma
      ? new PrismaProjectRepository(prisma)
      : new NullProjectRepository();
    return traced(new ProjectService(repo), "ProjectService");
  }

  async getById(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }

  async isFeatureEnabled(
    projectId: string,
    flag: ProjectFeatureFlag,
  ): Promise<boolean> {
    const project = await this.repo.getById(projectId);
    return project ? Boolean(project[flag]) : false;
  }
}
