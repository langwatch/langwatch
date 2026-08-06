import { HandledError } from "@langwatch/handled-error";
import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "./codexRefusalMessage";
import type { ModelRole } from "./featureRegistry";

/**
 * Thrown by `resolveModelForFeature` when every value the cascade walk found
 * for this feature was a restricted (codex) model it had to skip — as
 * opposed to nothing being configured at all.
 *
 * A SIBLING of `ModelNotConfiguredError`, deliberately not a subclass:
 * `server/api/trpc.ts`'s missing-model toast matches
 * `error.cause instanceof ModelNotConfiguredError` to open the "configure a
 * default" prompt, and this is a different problem with a different fix
 * (change the restricted value, not add a first one) — a subclass would
 * reopen that toast with the wrong message. `HandledError` (HTTP 400) so the
 * REST middleware and the tRPC `domainError` channel both recognize it via
 * `HandledError.isHandled()`.
 *
 * Carries the same popup-context fields as `ModelNotConfiguredError` plus
 * `restrictedModels`, the distinct model ids skipped along the walk, so the
 * caller can name what has to change.
 */
export class ModelRestrictedForFeatureError extends HandledError {
  declare readonly code: "model_restricted_for_feature";

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly projectId: string,
    public readonly restrictedModels: readonly string[],
  ) {
    const restrictedModel = restrictedModels[0] ?? "restricted model";
    super(
      "model_restricted_for_feature",
      `"${restrictedModel}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be the model for "${featureKey}".`,
      {
        httpStatus: 400,
        meta: { featureKey, role, featureDisplayName, projectId, restrictedModels },
      },
    );
    this.name = "ModelRestrictedForFeatureError";
  }
}
