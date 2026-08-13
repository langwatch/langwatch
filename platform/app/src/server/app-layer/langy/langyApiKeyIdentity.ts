import type { featureFlagService } from "~/server/featureFlag";
import { hasLangyAccess } from "./langyAccessGate";

type LangyFlagEvaluator = Pick<typeof featureFlagService, "isEnabled">;

/**
 * The parts of a resolved credential this bridge reads, as a type.
 *
 * Narrower than `ResolvedToken` on purpose. The full union carries a whole
 * Prisma `Project`, so a fixture for it can only be cast into place — and a
 * cast keeps compiling after the contract it claims to honour has moved. Naming
 * the four fields that are actually read lets a test double satisfy the
 * parameter honestly, while `langy-api.ts` still passes a real `ResolvedToken`
 * in: if the credential's shape changes, that call site fails the typecheck.
 */
export type LangyIdentityToken =
  | {
      type: "legacyProjectKey";
      project: { id: string; team: { organizationId: string } };
    }
  | {
      type: "apiKey";
      userId: string | null;
      project: { id: string; team: { organizationId: string } };
    };

/**
 * Why a key-authed Langy request was refused, once the key itself is known to
 * be valid and to carry the required permission.
 *
 * `unowned` and `no-access` are deliberately distinct even though both answer
 * 403. They are different operational problems: `unowned` means the key can
 * never work until someone re-issues it against a user, while `no-access`
 * means the key is fine and the cohort changed. On-call reading a log line
 * should not have to guess which of those happened.
 */
export type LangyIdentityDenialReason = "unowned" | "no-access";

export type LangyKeyIdentity =
  | { ok: true; userId: string }
  | { ok: false; reason: LangyIdentityDenialReason; message: string };

/**
 * Bridges a project API key to the identity the Langy access gate judges.
 *
 * The key authenticates the *caller*; it does not by itself say who is acting.
 * `hasLangyAccess` is a per-user decision (ADR-033: the opted-in cohort is the
 * security boundary while workers share the manager pod's network namespace),
 * so a key-authed surface has to name a user before it may provision anything.
 * That user is the key's owner — `apiKeyUserId` — and never a value taken from
 * the request body, which is the trap the internal relay plane fell into:
 * `services/langyagent/transport/rpc/http.go` authenticates the caller with a
 * shared secret and then reads `actorUserId` from the payload on assertion.
 * Here the identity is derived from the credential, so a caller cannot name
 * someone else.
 *
 * Fails closed on an ownerless key. Langy keys auto-provisioned per project are
 * deliberately owned by no individual (`specs/langy/langy-api-key-provisioning.feature`),
 * and there is no user whose flag evaluation would be meaningful for one — so
 * rather than inventing a distinguished id or evaluating the flag on project
 * alone, this refuses. Evaluating on the project would hand Langy to every
 * project whose flag is on regardless of who was opted in, which is exactly the
 * identity-based hole the gate's doc comment says must not exist.
 *
 * Transport-free, mirroring {@link hasLangyAccess}: returns a discriminated
 * result and never throws, so the REST surface maps a denial to its own status
 * and envelope. `flags` is injectable purely so the decision is unit-testable
 * without the flag service.
 */
export async function resolveLangyKeyIdentity({
  resolved,
  flags,
}: {
  resolved: LangyIdentityToken;
  flags?: LangyFlagEvaluator;
}): Promise<LangyKeyIdentity> {
  const userId = resolved.type === "apiKey" ? resolved.userId : null;

  if (!userId) {
    return {
      ok: false,
      reason: "unowned",
      message:
        "This API key is not owned by a user, so it cannot start a Langy conversation. Langy acts as a person, and the access decision is made per user. Use a key issued to a user with Langy access.",
    };
  }

  const allowed = await hasLangyAccess({
    user: { id: userId },
    projectId: resolved.project.id,
    organizationId: resolved.project.team.organizationId,
    ...(flags ? { flags } : {}),
  });

  if (!allowed) {
    return {
      ok: false,
      reason: "no-access",
      message:
        "The user this API key belongs to does not have access to Langy. Access is granted per user, so a key keeps working for everything else while Langy stays refused.",
    };
  }

  return { ok: true, userId };
}
