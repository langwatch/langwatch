import type { FeatureFlagApi } from "./feature-flag.api.ts";

/** Projects whose legacy key (`Project.apiKey`) keeps every permission of its project. */
export const LEGACY_PROJECT_KEY_FULL_ACCESS_FLAG_KEY = "legacy_project_key_full_access" as const;

/**
 * The one read of `legacy_project_key_full_access`, for the legacy key's own project
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export function legacyProjectKeyHasFullAccess(params: {
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  project: Readonly<{ id: string; organizationId: string }>;
}): Promise<boolean> {
  return params.featureFlags.isEnabled(LEGACY_PROJECT_KEY_FULL_ACCESS_FLAG_KEY, {
    kind: "project",
    projectId: params.project.id,
    organizationId: params.project.organizationId,
  });
}
