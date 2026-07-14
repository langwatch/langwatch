import type { ModelRole } from "./featureRegistry";

/**
 * Stable wire-format cause carried on tRPC/REST responses so the frontend
 * interceptor can match without sniffing message strings.
 */
export const MODEL_NOT_CONFIGURED_CAUSE = "MODEL_NOT_CONFIGURED" as const;

/**
 * Thrown by `resolveModelForFeature` when nothing in the scope chain nor a
 * built-in constant can produce a model for the requested feature. The
 * frontend `tRPC` interceptor matches on `cause === MODEL_NOT_CONFIGURED`
 * and opens the missing-model modal with the role+feature in context.
 *
 * Carries enough state for the popup to render and deep-link:
 *   - featureKey: stable identifier of the feature that failed to resolve
 *   - role: which role (Default / Fast / Embeddings) had no model set
 *   - featureDisplayName: the user-facing copy from the registry
 *   - projectId: the project the resolve was called for, so the popup can
 *                deep-link the user back to the right settings page scope
 */
export class ModelNotConfiguredError extends Error {
  public readonly cause = MODEL_NOT_CONFIGURED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly projectId: string,
  ) {
    super(
      `No model configured for "${featureKey}" (role: ${role}, project: ${projectId}).`,
    );
    this.name = "ModelNotConfiguredError";
  }

  /**
   * Serialisable shape for the tRPC / REST error response body. The
   * frontend interceptor matches `cause` and reads the rest to render
   * the popup.
   */
  toResponseBody(): {
    cause: typeof MODEL_NOT_CONFIGURED_CAUSE;
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
    projectId: string;
  } {
    return {
      cause: this.cause,
      featureKey: this.featureKey,
      role: this.role,
      featureDisplayName: this.featureDisplayName,
      projectId: this.projectId,
    };
  }
}
