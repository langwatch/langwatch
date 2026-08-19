/**
 * The `/api/teams` REST family, which shipped without a CLI.
 *
 * Teams group projects and members; membership is a team-scoped role binding,
 * which is why adding a member takes the role they get on the team.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  type ManagementRequest,
  resolveManagementToken,
} from "../_shared/management-request";
import type { ManagementRole } from "../_shared/management-types";

export interface Team {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPagination {
  page: number;
  limit: number;
  total: number;
}

export interface ListTeamsResponse {
  data: Team[];
  pagination: TeamPagination;
}

export interface ArchivedTeam {
  id: string;
  name: string;
  archivedAt: string | null;
}

export interface TeamMember {
  userId: string | null;
  name: string | null;
  email: string | null;
  role: ManagementRole;
}

export class TeamsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "TeamsApiError";
  }
}

export class TeamsApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveManagementToken({ apiKey: config?.apiKey }),
      errorFactory: ({ message, operation, body }) =>
        new TeamsApiError(message, operation, body),
    });
  }

  async list(
    options: { page?: number; limit?: number } = {},
  ): Promise<ListTeamsResponse> {
    return this.#request({
      operation: "list teams",
      path: "/api/teams",
      query: { ...options },
    });
  }

  async get(id: string): Promise<Team> {
    return this.#request({
      operation: `fetch team "${id}"`,
      path: `/api/teams/${encodeURIComponent(id)}`,
    });
  }

  async create(input: { name: string }): Promise<Team> {
    return this.#request({
      operation: "create team",
      path: "/api/teams",
      method: "POST",
      body: input,
    });
  }

  async update({
    id,
    input,
  }: {
    id: string;
    input: { name?: string };
  }): Promise<Team> {
    return this.#request({
      operation: `update team "${id}"`,
      path: `/api/teams/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: input,
    });
  }

  async archive(id: string): Promise<ArchivedTeam> {
    return this.#request({
      operation: `archive team "${id}"`,
      path: `/api/teams/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
  }

  async listMembers(teamId: string): Promise<{ data: TeamMember[] }> {
    return this.#request({
      operation: `list members of team "${teamId}"`,
      path: `/api/teams/${encodeURIComponent(teamId)}/members`,
    });
  }

  async addMember({
    teamId,
    input,
  }: {
    teamId: string;
    input: { userId: string; role?: ManagementRole };
  }): Promise<{ success: boolean }> {
    return this.#request({
      operation: `add a member to team "${teamId}"`,
      path: `/api/teams/${encodeURIComponent(teamId)}/members`,
      method: "POST",
      body: input,
    });
  }

  async removeMember({
    teamId,
    userId,
  }: {
    teamId: string;
    userId: string;
  }): Promise<{ success: boolean }> {
    return this.#request({
      operation: `remove member "${userId}" from team "${teamId}"`,
      path: `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      method: "DELETE",
    });
  }
}
