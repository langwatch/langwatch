import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface Project {
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

export interface CreateProjectInput {
  name: string;
  language: string;
  framework: string;
  teamId?: string;
  newTeamName?: string;
}

export interface UpdateProjectInput {
  name?: string;
  language?: string;
  framework?: string;
  piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
}

export interface ProjectWithServiceKey extends Project {
  serviceApiKey: string;
  serviceApiKeyId: string;
}

export interface PaginatedProjects {
  data: Project[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ArchivedProject {
  id: string;
  name: string;
  archivedAt: string;
}

export class ProjectsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ProjectsApiError";
  }
}

export class ProjectsApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = (config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(operation: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = await response.text();
      }
      const message = formatApiErrorForOperation({
        operation,
        error: parsedBody,
        options: { status: response.status },
      });
      throw new ProjectsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(options?: { page?: number; limit?: number }): Promise<PaginatedProjects> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.request<PaginatedProjects>(
      "list projects",
      `/api/projects${qs ? `?${qs}` : ""}`,
    );
  }

  async get(id: string): Promise<Project> {
    return this.request<Project>(
      `get project "${id}"`,
      `/api/projects/${encodeURIComponent(id)}`,
    );
  }

  async create(input: CreateProjectInput): Promise<ProjectWithServiceKey> {
    return this.request<ProjectWithServiceKey>(
      "create project",
      "/api/projects",
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    return this.request<Project>(
      `update project "${id}"`,
      `/api/projects/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  }

  async archive(id: string): Promise<ArchivedProject> {
    return this.request<ArchivedProject>(
      `archive project "${id}"`,
      `/api/projects/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
}
