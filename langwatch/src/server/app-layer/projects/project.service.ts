import type { Project } from "@prisma/client";
import type {
  ProjectRepository,
  ProjectWithTeam,
  UpdateProjectMetadataInput,
} from "./repositories/project.repository";

/** All boolean fields on Project whose name starts with "feature". */
export type ProjectFeatureFlag = Extract<keyof Project, `feature${string}`>;

export class ProjectService {
  constructor(readonly repo: ProjectRepository) {}

  async getById(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repo.getWithTeam(id);
  }

  async updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.repo.updateMetadata(input);
  }

  async isFeatureEnabled(
    projectId: string,
    flag: ProjectFeatureFlag,
  ): Promise<boolean> {
    const project = await this.repo.getById(projectId);
    return project ? Boolean(project[flag]) : false;
  }
}
