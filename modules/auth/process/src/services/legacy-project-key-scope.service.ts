import {
  INGESTION_PERMISSIONS,
  LegacyProjectKeyIngestionOnlyError,
} from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

/** The project a legacy key is, as far as its scope is concerned. */
export type LegacyKeyProject = Readonly<{ id: string; organizationId: string }>;

/**
 * A legacy project key (`Project.apiKey`) holds only the ingestion permissions, unless its project
 * is on `legacy_project_key_full_access`
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export class LegacyProjectKeyScopeService {
  static create(peers: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): LegacyProjectKeyScopeService {
    return new LegacyProjectKeyScopeService(peers.featureFlags);
  }

  private constructor(private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">) {}

  async holds(input: { project: LegacyKeyProject; permission: AuthzPermission }): Promise<boolean> {
    if (INGESTION_PERMISSIONS.includes(input.permission)) return true;

    return this.holdsFullAccess(input.project);
  }

  holdsFullAccess(project: LegacyKeyProject): Promise<boolean> {
    return this.featureFlags.isEnabled("legacy_project_key_full_access", {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
    });
  }

  /** A route that asks no permission is never ingestion, so only full access opens it. */
  async assertMayIdentify(project: LegacyKeyProject): Promise<void> {
    if (!(await this.holdsFullAccess(project))) throw new LegacyProjectKeyIngestionOnlyError();
  }
}
