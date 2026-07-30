import { HandledError } from "@langwatch/handled-error";

import type { ModelRole } from "./featureRegistry";
import type { ResolutionScope } from "./resolveModelForFeature";

/**
 * Legacy wire-format discriminator carried on the tRPC `data.cause` sidecar.
 *
 * @deprecated NOT the error's code — the code is `model_provider_disabled`,
 * which is what `APP_ERROR_CODES` enumerates and what the presentation
 * registry writes copy for. This constant survives for one consumer:
 * `src/utils/trpcError.ts::extractProviderDisabledInfo`, fed by the bespoke
 * `providerDisabledCause` block in `src/server/api/trpc.ts`. New code reads
 * `error.code`.
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
 * model whose provider is currently disabled. A `HandledError` carrying the
 * enumerated `model_provider_disabled` code, so the words a customer reads
 * come from the code-keyed presentation registry. The frontend
 * `extractProviderDisabledInfo` interceptor additionally matches on the
 * legacy `cause === MODEL_PROVIDER_DISABLED` sidecar and opens the swap toast.
 *
 * `httpStatus` is 400 (the caller can fix it) and `fault` stays `customer` —
 * the provider was disabled in their own settings.
 *
 * Carries:
 *   - featureKey / featureDisplayName / role — for messaging + telemetry
 *   - resolvedScope / resolvedModel / providerKey — the disabled config
 *   - alternate — the next cascade candidate, if any, so the toast can
 *     offer a one-click swap
 *   - projectId — so the action button knows which scope row to clear
 *
 * All of it is the customer's own configuration, so all of it is safe on the
 * client contract; it rides in `meta` as well as on the legacy sidecar so the
 * bespoke `providerDisabledCause` block in `trpc.ts` can be retired without
 * the toast losing what it needs.
 */
export class ModelProviderDisabledError extends HandledError {
  declare readonly code: "model_provider_disabled";

  /**
   * @deprecated The legacy alias of `code` — see
   * {@link MODEL_PROVIDER_DISABLED_CAUSE}.
   */
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
      "model_provider_disabled",
      `Model "${resolvedModel}" is configured at ${resolvedScope} scope for "${featureKey}", but its provider "${providerKey}" is currently disabled.`,
      {
        httpStatus: 400,
        meta: {
          featureKey,
          featureDisplayName,
          role,
          projectId,
          resolvedScope,
          resolvedModel,
          providerKey,
          alternate,
        },
      },
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
