import type { FeatureFlagService, FeatureFlagTarget } from "@langwatch/feature-flag-contract";

/**
 * The rollout flag Langy access hangs off, and the only lever that opens it.
 *
 * Declared here rather than imported: the other holder of the key is a BROWSER
 * module (`useShowLangy`), which a server package may not reach. The key is
 * the flag registry's own identifier, so the registry is what pins the two
 * together, not a shared constant. Registered with `defaultValue: false`, so
 * Langy is dark everywhere until the flag is turned on for a project, an
 * organization, or a user.
 */
export const LANGY_RELEASE_FLAG = "release_langy_enabled" as const;

function targetForLangyAccess(input: {
  user: { id: string };
  projectId?: string;
  organizationId?: string;
}): FeatureFlagTarget {
  if (input.projectId) {
    return {
      kind: "project",
      userId: input.user.id,
      projectId: input.projectId,
      organizationId: input.organizationId,
    };
  }

  if (input.organizationId) {
    return {
      kind: "organization",
      userId: input.user.id,
      organizationId: input.organizationId,
    };
  }

  return { kind: "user", userId: input.user.id };
}

/** Decides whether one user may reach Langy in a given scope. */
export class LangyAccessService {
  static create(options: { featureFlags: FeatureFlagService }): LangyAccessService {
    return new LangyAccessService(options);
  }

  private readonly featureFlags: FeatureFlagService;

  private constructor(options: { featureFlags: FeatureFlagService }) {
    this.featureFlags = options.featureFlags;
  }

  async hasAccess(input: {
    user: { id: string };
    projectId?: string;
    organizationId?: string;
  }): Promise<boolean> {
    return this.featureFlags.isEnabled(LANGY_RELEASE_FLAG, targetForLangyAccess(input));
  }
}
