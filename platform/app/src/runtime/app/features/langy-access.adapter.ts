import type { FeatureFlagService, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { LANGY_RELEASE_FLAG } from "~/utils/langyReleaseFlag";

export async function hasLangyAccess(input: {
  user: { id: string };
  projectId?: string;
  organizationId?: string;
  featureFlags: FeatureFlagService;
}): Promise<boolean> {
  return input.featureFlags.isEnabled(LANGY_RELEASE_FLAG, targetForLangyAccess(input));
}

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
