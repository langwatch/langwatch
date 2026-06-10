import type { Team } from "@prisma/client";

export interface CreateTeamInput {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

export interface UpdateTeamInput {
  name?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}

export interface TeamRepository {
  findById(id: string): Promise<Team | null>;
  findAllByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Team>>;
  findBySlugInOrganization(params: {
    slug: string;
    organizationId: string;
  }): Promise<Team | null>;
  create(data: CreateTeamInput): Promise<Team>;
  update(params: {
    id: string;
    organizationId: string;
    data: UpdateTeamInput;
  }): Promise<Team | null>;
  archive(params: {
    id: string;
    organizationId: string;
  }): Promise<Team | null>;
}
