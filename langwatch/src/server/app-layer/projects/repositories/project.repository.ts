import type { Project, Team } from "@prisma/client";

export type ProjectWithTeam = Project & { team: Team };

export interface ProjectWithOrgAdmin {
  firstMessage: boolean;
  organizationId: string | null;
  adminUserId: string | null;
}

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
  getWithTeam(id: string): Promise<ProjectWithTeam | null>;
  getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
}

export class NullProjectRepository implements ProjectRepository {
  async getById(_id: string): Promise<Project | null> {
    return null;
  }

  async getWithTeam(_id: string): Promise<ProjectWithTeam | null> {
    return null;
  }

  async getWithOrgAdmin(_id: string): Promise<ProjectWithOrgAdmin | null> {
    return null;
  }
}
