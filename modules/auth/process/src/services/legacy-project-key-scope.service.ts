import {
  INGESTION_PERMISSIONS,
  LegacyProjectKeyIngestionOnlyError,
  legacyProjectKeyScopeFlagSchema,
} from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import {
  legacyProjectKeyHasFullAccess,
  type FeatureFlagApi,
} from "@langwatch/feature-flag-contract";

/** The project a legacy key is, as far as its scope is concerned. */
type LegacyKeyProject = Readonly<{ id: string; organizationId: string }>;

/**
 * A legacy project key holds ingestion; a route naming scope flags (`withLegacyKeyScope`) when
 * one lists its project; everything on `legacy_project_key_full_access`
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export class LegacyProjectKeyScopeService {
  static create(peers: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): LegacyProjectKeyScopeService {
    return new LegacyProjectKeyScopeService(peers.featureFlags);
  }

  private constructor(private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">) {}

  /** Reads only the scope flags the route names, then full access. */
  async holds(input: {
    project: LegacyKeyProject;
    permission: AuthzPermission;
    routeScopes?: readonly string[];
  }): Promise<boolean> {
    const { project, permission, routeScopes = [] } = input;
    if (INGESTION_PERMISSIONS.includes(permission)) return true;

    for (const scope of routeScopes) {
      const flag = legacyProjectKeyScopeFlagSchema.parse(scope);
      if (await this.featureFlags.isEnabled(flag, this.#target(project))) return true;
    }

    return this.holdsFullAccess(project);
  }

  holdsFullAccess(project: LegacyKeyProject): Promise<boolean> {
    return legacyProjectKeyHasFullAccess({ featureFlags: this.featureFlags, project });
  }

  /** A route that asks no permission names no scope flag, so only full access opens it. */
  async assertMayIdentify(project: LegacyKeyProject): Promise<void> {
    if (!(await this.holdsFullAccess(project))) throw new LegacyProjectKeyIngestionOnlyError();
  }

  #target(project: LegacyKeyProject) {
    return {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
    } as const;
  }
}
