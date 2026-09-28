import { makeRequest } from "./langwatch-api.js";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  piiRedactionLevel: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListResponse {
  data: ProjectSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ProjectCreateResponse extends ProjectSummary {
  serviceApiKey: string;
  serviceApiKeyId: string;
}

export async function listProjects(params?: {
  page?: number;
  limit?: number;
}): Promise<ProjectListResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString() ? `?${query}` : "";
  return makeRequest("GET", `/api/projects${qs}`) as Promise<ProjectListResponse>;
}

export async function getProject(id: string): Promise<ProjectSummary> {
  return makeRequest("GET", `/api/projects/${encodeURIComponent(id)}`) as Promise<ProjectSummary>;
}

/** Identity of the project the calling API key belongs to. */
export interface CurrentProjectIdentity {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
}

/**
 * Resolves the project behind the configured API key. Needed for the
 * `/api/v1/projects/:projectId/...` route family, whose path must name the
 * caller's own project — there is no "current project" shorthand there.
 */
export async function getCurrentProject(): Promise<CurrentProjectIdentity> {
  return makeRequest(
    "GET",
    "/api/me/project",
  ) as Promise<CurrentProjectIdentity>;
}

export async function createProject(data: {
  name: string;
  language: string;
  framework: string;
  teamId?: string;
  newTeamName?: string;
}): Promise<ProjectCreateResponse> {
  return makeRequest("POST", "/api/projects", data) as Promise<ProjectCreateResponse>;
}

export async function updateProject(params: {
  id: string;
  name?: string;
  language?: string;
  framework?: string;
  piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
}): Promise<ProjectSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/projects/${encodeURIComponent(id)}`,
    data,
  ) as Promise<ProjectSummary>;
}

export async function archiveProject(id: string): Promise<{
  id: string;
  name: string;
  archivedAt: string;
}> {
  return makeRequest("DELETE", `/api/projects/${encodeURIComponent(id)}`) as Promise<{
    id: string;
    name: string;
    archivedAt: string;
  }>;
}
