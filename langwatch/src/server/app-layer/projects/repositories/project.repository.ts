import type { Project, Team } from "@prisma/client";

export type ProjectWithTeam = Project & { team: Team };

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
  getWithTeam(id: string): Promise<ProjectWithTeam | null>;
}

export class NullProjectRepository implements ProjectRepository {
  async getById(_id: string): Promise<Project | null> {
    return null;
  }

  async getWithTeam(_id: string): Promise<ProjectWithTeam | null> {
    return null;
  }
}
