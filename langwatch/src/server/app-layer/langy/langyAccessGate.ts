import { featureFlagService } from "~/server/featureFlag";
import { LANGY_RELEASE_FLAG } from "~/utils/langyReleaseFlag";

type LangyAccessUser = {
  id: string;
};

type LangyFlagEvaluator = Pick<typeof featureFlagService, "isEnabled">;

/**
 * The one authoritative answer to "may this user use Langy?", shared by every
 * customer-facing surface: the tRPC routers (`langy`, `langyGithub`,
 * `langyEgress`, via the `enforceLangyAccess` middleware) and the GitHub install
 * REST route. Every caller — staff included — must pass the same
 * `release_langy_enabled` evaluation; there is no identity-based bypass, so the
 * flag is a true kill switch rather than one with a hole in it.
 *
 * That matters while Langy's OpenCode workers still share the manager pod's
 * network namespace: a prompt-injected worker can reach a sibling's
 * unauthenticated control port and lift that user's live credentials, so the
 * cohort must stay exactly who was deliberately opted in (ADR-033). UI hiding is
 * not a security boundary; this server-side gate is.
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
  return flags.isEnabled(LANGY_RELEASE_FLAG, {
    distinctId: user.id,
    ...(projectId ? { projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
}
