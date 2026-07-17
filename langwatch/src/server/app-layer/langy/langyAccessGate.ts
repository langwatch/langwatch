import { featureFlagService } from "~/server/featureFlag";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";

type LangyAccessUser = {
  id: string;
  email?: string | null;
  emailVerified?: boolean | null;
};

type LangyFlagEvaluator = Pick<typeof featureFlagService, "isEnabled">;

/**
 * Authoritative server-side rollout gate for every customer-facing Langy
 * surface. Staff bypass the rollout flag; everyone else must pass the same
 * release_langy_enabled evaluation. SaaS pins that flag false in production
 * while worker processes share the manager pod network namespace.
 */
export async function hasLangyAccess({
  user,
  projectId,
  organizationId,
  flags = featureFlagService,
}: {
  user: LangyAccessUser;
  projectId?: string;
  organizationId?: string;
  flags?: LangyFlagEvaluator;
}): Promise<boolean> {
  if (isLangwatchStaff(user)) return true;

  return flags.isEnabled("release_langy_enabled", {
    distinctId: user.id,
    ...(projectId ? { projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
}
