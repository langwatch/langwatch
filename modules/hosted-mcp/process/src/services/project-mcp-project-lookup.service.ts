import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";

/**
 * A key read: the live project it belongs to, a legacy key whose project keeps it to ingestion,
 * or an unknown key the caller refuses.
 */
export type McpLiveProjectLookup =
  | { kind: "live"; project: { id: string; teamId: string } }
  | { kind: "ingestion_only" }
  | { kind: "unknown" };

/**
 * The project an MCP bearer token belongs to, read through the project
 * module's own peer capability rather than this module's tables.
 */
export class ProjectMcpProjectLookupService {
  readonly #projects: ProjectApi;
  readonly #featureFlags: Pick<FeatureFlagApi, "isEnabled">;

  private constructor(projects: ProjectApi, featureFlags: Pick<FeatureFlagApi, "isEnabled">) {
    this.#projects = projects;
    this.#featureFlags = featureFlags;
  }

  static create({
    projects,
    featureFlags,
  }: {
    projects: ProjectApi;
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): ProjectMcpProjectLookupService {
    return new ProjectMcpProjectLookupService(projects, featureFlags);
  }

  async resolveLiveProjectByApiKey(input: { apiKey: string }): Promise<McpLiveProjectLookup> {
    const projectId = await this.#projects.findIdByLegacyApiKey({ token: input.apiKey });
    if (!projectId) return { kind: "unknown" };

    const identity = await this.#projects.findIdentity(projectId);
    // ADR-144 decision 7: an aggregate accepts no key, its own included.
    if (!identity || isAggregateProjectKind(identity.kind)) return { kind: "unknown" };

    // The bearer is the project's legacy key, which only sends traces unless its project is kept.
    const fullAccess = await this.#featureFlags.isEnabled("legacy_project_key_full_access", {
      kind: "project",
      projectId: identity.id,
      organizationId: identity.organizationId,
    });

    return fullAccess
      ? { kind: "live", project: { id: identity.id, teamId: identity.teamId } }
      : { kind: "ingestion_only" };
  }
}
