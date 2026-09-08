import type { featureFlagService } from "~/server/featureFlag";
import { hasLangyAccess } from "./langyAccessGate";

type LangyFlagEvaluator = Pick<typeof featureFlagService, "isEnabled">;

/**
 * The parts of a resolved credential this bridge reads, as a type.
 *
 * Narrower than `ResolvedToken` on purpose. The full union carries a whole
 * Prisma `Project`, so a fixture for it can only be cast into place — and a
 * cast keeps compiling after the contract it claims to honour has moved. Naming
 * the fields that are actually read lets a test double satisfy the parameter
 * honestly, while `langy-api.ts` still passes a real `ResolvedToken` in: if
 * the credential's shape changes, that call site fails the typecheck.
 */
export type LangyIdentityToken =
  | {
      type: "legacyProjectKey";
      project: { id: string; team: { organizationId: string } };
    }
  | {
      type: "apiKey";
      apiKeyId: string;
      userId: string | null;
      project: { id: string; team: { organizationId: string } };
    };

/**
 * Who a key-authed Langy turn acts as.
 *
 * A personal key acts as its owner. A service key — an API key issued to no
 * user, the credential an uptime monitor or a CI job holds — acts as itself:
 * the key is the principal and its own role bindings are the ceiling, which
 * is already how `resolveApiKeyPermission` treats an ownerless key. The turn
 * is attributed to the key's id, so the conversation, the session key and
 * the log line all name the credential that started it rather than a person
 * who did not.
 */
export type LangyActor =
  | { type: "user"; id: string }
  | { type: "apiKey"; id: string };

/**
 * Why a key-authed Langy request was refused, once the key itself is known to
 * be valid and to carry the required permission.
 *
 * `unowned` and `no-access` are deliberately distinct even though both answer
 * 403. They are different operational problems: `unowned` means this
 * credential class can never work (the project's own key has no identity to
 * act as; only an API key from the organization's API keys page does), while
 * `no-access` means the key is fine and the cohort changed. On-call reading a
 * log line should not have to guess which of those happened.
 */
export type LangyIdentityDenialReason = "unowned" | "no-access";

export type LangyKeyIdentity =
  | { ok: true; actor: LangyActor }
  | { ok: false; reason: LangyIdentityDenialReason; message: string };

/**
 * Bridges a project API key to the principal the Langy access gate judges.
 *
 * The key authenticates the *caller*; it does not by itself say who is acting.
 * `hasLangyAccess` decides per principal (ADR-033: the opted-in cohort is the
 * security boundary while workers share the manager pod's network namespace),
 * so a key-authed surface has to name that principal before it may provision
 * anything. The principal is derived from the credential — the key's owner
 * for a personal key, the key itself for a service key — and never from the
 * request body, which is the trap the internal relay plane fell into:
 * `services/langyagent/transport/rpc/http.go` authenticates the caller with a
 * shared secret and then reads `actorUserId` from the payload on assertion.
 * Here a caller cannot name someone else.
 *
 * A service key is judged by the same gate with its own id as the distinct
 * id. Flag rules match on project and organization only
 * (`featureFlag/rules.ts`), so a service key is admitted exactly when its
 * project or organization was opted in, which is the same decision every
 * user of that project already gets; there is no broader cohort to hand it.
 * When neither is targeted it is refused like anyone else.
 *
 * The project's own key (the legacy `Project.apiKey`) stays refused. It has no
 * role bindings to clamp a session key to and no id of its own to act as, so
 * there is nothing for a turn to run as.
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
  if (resolved.type !== "apiKey") {
    return {
      ok: false,
      reason: "unowned",
      message:
        "The project's own API key cannot start a Langy conversation: it has no identity of its own to act as. Use an API key from the organization's API keys page, either a personal key or a service key, that has Langy access in this project.",
    };
  }

  const actor: LangyActor = resolved.userId
    ? { type: "user", id: resolved.userId }
    : { type: "apiKey", id: resolved.apiKeyId };

  const allowed = await hasLangyAccess({
    user: { id: actor.id },
    projectId: resolved.project.id,
    organizationId: resolved.project.team.organizationId,
    ...(flags ? { flags } : {}),
  });

  if (!allowed) {
    return {
      ok: false,
      reason: "no-access",
      message:
        actor.type === "user"
          ? "The user this API key belongs to does not have access to Langy. Access is granted per user, so a key keeps working for everything else while Langy stays refused."
          : "This service key's project does not have access to Langy. Access is granted per project for a service key, so it keeps working for everything else while Langy stays refused.",
    };
  }

  return { ok: true, actor };
}
