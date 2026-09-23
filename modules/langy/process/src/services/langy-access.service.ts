import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";

/**
 * The rollout flag Langy access hangs off, and the only lever that opens it. Declared here rather
 * than imported: the other holder of the key is a BROWSER module (`useShowLangy`), which a server
 * package may not reach.
 */
export const LANGY_RELEASE_FLAG = "release_langy_enabled" as const;

/** A session user carries an email for domain-targeted rules; an API key's owner carries none. */
type LangyAccessUser = { id: string; email?: string | null };

function targetForLangyAccess(input: {
  user: LangyAccessUser;
  projectId?: string;
  organizationId?: string;
}): FeatureFlagTarget {
  const email = input.user.email ? { userEmail: input.user.email } : {};
  if (input.projectId) {
    return {
      kind: "project",
      userId: input.user.id,
      projectId: input.projectId,
      organizationId: input.organizationId,
      ...email,
    };
  }

  if (input.organizationId) {
    return {
      kind: "organization",
      userId: input.user.id,
      organizationId: input.organizationId,
      ...email,
    };
  }

  return { kind: "user", userId: input.user.id, ...email };
}

/** Decides whether one user may reach Langy in a given scope. */
export class LangyAccessService {
  static create(options: { featureFlags: FeatureFlagApi }): LangyAccessService {
    return new LangyAccessService(options);
  }

  private readonly featureFlags: FeatureFlagApi;

  private constructor(options: { featureFlags: FeatureFlagApi }) {
    this.featureFlags = options.featureFlags;
  }

  async hasAccess(input: {
    user: LangyAccessUser;
    projectId?: string;
    organizationId?: string;
  }): Promise<boolean> {
    return this.featureFlags.isEnabled(LANGY_RELEASE_FLAG, targetForLangyAccess(input));
  }
}
