import { featureFlagService } from "~/server/featureFlag";
import { isLangwatchStaff, LANGY_RELEASE_FLAG } from "~/utils/isLangwatchStaff";

type LangyAccessUser = {
  id: string;
  email?: string | null;
  emailVerified?: boolean | null;
};

type LangyFlagEvaluator = Pick<typeof featureFlagService, "isEnabled">;

/**
 * The one authoritative answer to "may this user use Langy?", shared by every
 * customer-facing surface: the tRPC routers (`langy`, `langyGithub`,
 * `langyEgress`, via the `enforceLangyAccess` middleware) and the GitHub install
 * REST route. Staff bypass the rollout flag; everyone else must pass the same
 * `release_langy_enabled` evaluation. SaaS pins that flag false in production
 * while OpenCode workers still share the manager pod's network namespace — until
 * worker-level network isolation lands, UI hiding is not a security boundary, so
 * this server-side gate is.
 *
 * Transport-free by design: it returns a boolean and never throws an HTTP/tRPC
 * error, so each surface maps a denial to its own response shape (tRPC
 * `NOT_FOUND`, REST `404`) without this module knowing about either. `flags` is
 * injectable purely so the decision can be unit-tested without the flag service.
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

  return flags.isEnabled(LANGY_RELEASE_FLAG, {
    distinctId: user.id,
    ...(projectId ? { projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
}
