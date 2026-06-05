import type { ModelRole } from "./featureRegistry";
import type { ResolutionScope } from "./resolveModelForFeature";

/**
 * Stable wire-format cause carried on tRPC/REST responses so the frontend
 * interceptor can match without sniffing message strings. Distinct from
 * MODEL_NOT_CONFIGURED — the cascade DID find a model, it's just unusable
 * right now because the backing provider is disabled.
 */
export const MODEL_PROVIDER_DISABLED_CAUSE = "MODEL_PROVIDER_DISABLED" as const;

/**
 * The cascade-next alternative the user could swap to with one click.
 * Present when the cascade walk found a parent-scope candidate. Absent
 * when this was the only configured tier (in which case the only fix is
 * to either re-enable the provider or pick a different model at this
 * scope).
 */
export interface ResolvedAlternate {
  scope: Exclude<ResolutionScope, null>;
  model: string;
  providerKey: string;
  providerEnabled: boolean;
}

/**
 * Thrown by `getVercelAIModel` when the cascade resolver picked a
 * model whose provider is currently disabled. The frontend
 * `extractModelProviderDisabledInfo` interceptor matches on
 * `cause === MODEL_PROVIDER_DISABLED` and opens the swap toast.
 *
 * Carries:
 *   - featureKey / featureDisplayName / role — for messaging + telemetry
 *   - resolvedScope / resolvedModel / providerKey — the disabled config
 *   - alternate — the next cascade candidate, if any, so the toast can
 *     offer a one-click swap
 *   - projectId / projectScopeConfigId — so the action button knows
 *     which scope row to clear
 */
export class ModelProviderDisabledError extends Error {
  public readonly cause = MODEL_PROVIDER_DISABLED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly featureDisplayName: string,
    public readonly role: ModelRole,
    public readonly projectId: string,
    public readonly resolvedScope: Exclude<ResolutionScope, null>,
    public readonly resolvedModel: string,
    public readonly providerKey: string,
    public readonly alternate: ResolvedAlternate | null,
  ) {
    super(
      `Model "${resolvedModel}" is configured at ${resolvedScope} scope for "${featureKey}", but its provider "${providerKey}" is currently disabled.`,
    );
    this.name = "ModelProviderDisabledError";
  }

  /**
   * Serialisable shape for the tRPC / REST error response body. The
   * frontend interceptor matches `code` and renders the toast.
   *
   * Field is named `code` for consistency with ModelNotConfiguredError
   * and AiCallFailedError on the wire — the frontend extractor reads
   * `cause.code` to dispatch, regardless of the error class.
   */
  toResponseBody(): {
    code: typeof MODEL_PROVIDER_DISABLED_CAUSE;
    featureKey: string;
    featureDisplayName: string;
    role: ModelRole;
    projectId: string;
    resolvedScope: Exclude<ResolutionScope, null>;
    resolvedModel: string;
    providerKey: string;
    alternate: ResolvedAlternate | null;
  } {
    return {
      code: this.cause,
      featureKey: this.featureKey,
      featureDisplayName: this.featureDisplayName,
      role: this.role,
      projectId: this.projectId,
      resolvedScope: this.resolvedScope,
      resolvedModel: this.resolvedModel,
      providerKey: this.providerKey,
      alternate: this.alternate,
    };
  }
}
