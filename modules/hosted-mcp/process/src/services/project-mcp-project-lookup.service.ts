import type { ProjectApi } from "@langwatch/project-contract";

import { McpProjectLookup } from "../app/hosted-mcp-members.ts";

/**
 * The project an MCP bearer token belongs to, read through the project
 * module's own peer capability rather than this module's tables.
 */
export class ProjectMcpProjectLookupService extends McpProjectLookup {
  readonly #projects: ProjectApi;

  private constructor(projects: ProjectApi) {
    super();
    this.#projects = projects;
  }

  static create({ projects }: { projects: ProjectApi }): ProjectMcpProjectLookupService {
    return new ProjectMcpProjectLookupService(projects);
  }

  async tryFindLiveProjectByApiKey(input: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null> {
    const projectId = await this.#projects.findIdByLegacyApiKey({ token: input.apiKey });
    if (!projectId) return null;

    const identity = await this.#projects.findIdentity(projectId);
    return identity ? { id: identity.id, teamId: identity.teamId } : null;
  }
}
