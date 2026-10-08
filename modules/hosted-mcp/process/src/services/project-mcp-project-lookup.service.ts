import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";

/** A key read: the live project it belongs to, or an unknown key the caller refuses. */
export type McpLiveProjectLookup =
  | { kind: "live"; project: { id: string; teamId: string } }
  | { kind: "unknown" };

/**
 * The project an MCP bearer token belongs to, read through the project
 * module's own peer capability rather than this module's tables.
 */
export class ProjectMcpProjectLookupService {
  readonly #projects: ProjectApi;

  private constructor(projects: ProjectApi) {
    this.#projects = projects;
  }

  static create({ projects }: { projects: ProjectApi }): ProjectMcpProjectLookupService {
    return new ProjectMcpProjectLookupService(projects);
  }

  async resolveLiveProjectByApiKey(input: { apiKey: string }): Promise<McpLiveProjectLookup> {
    const projectId = await this.#projects.findIdByLegacyApiKey({ token: input.apiKey });
    if (!projectId) return { kind: "unknown" };

    const identity = await this.#projects.findIdentity(projectId);
    // ADR-175 decision 7: an aggregate accepts no key, its own stored one included.
    return identity && !isAggregateProjectKind(identity.kind)
      ? { kind: "live", project: { id: identity.id, teamId: identity.teamId } }
      : { kind: "unknown" };
  }
}
