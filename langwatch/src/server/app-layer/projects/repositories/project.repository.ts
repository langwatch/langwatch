import type { Project, Team } from "@prisma/client";

export type ProjectWithTeam = Project & { team: Team };

export type UpdateProjectMetadataInput = {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
};

export interface ProjectWithOrgAdmin {
  firstMessage: boolean;
  organizationId: string | null;
  adminUserId: string | null;
}

export interface SearchProjectsResult {
  id: string;
  name: string;
  slug: string;
}

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
  getWithTeam(id: string): Promise<ProjectWithTeam | null>;
  updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void>;
  getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  searchByQuery(params: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
}

export class NullProjectRepository implements ProjectRepository {
  async getById(_id: string): Promise<Project | null> {
    return null;
  }

  async getWithTeam(_id: string): Promise<ProjectWithTeam | null> {
    return null;
  }

  async updateMetadata(_input: UpdateProjectMetadataInput): Promise<void> {
    // no-op
  }

  async getWithOrgAdmin(_id: string): Promise<ProjectWithOrgAdmin | null> {
    return null;
  }

  async searchByQuery(_params: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return [];
  }
}
