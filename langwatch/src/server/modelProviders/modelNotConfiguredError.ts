import { HandledError } from "@langwatch/handled-error";
import type { ModelRole } from "./featureRegistry";

/**
 * Stable wire-format cause carried on tRPC/REST responses so the frontend
 * interceptor can match without sniffing message strings.
 */
export const MODEL_NOT_CONFIGURED_CAUSE = "MODEL_NOT_CONFIGURED" as const;

/**
 * Thrown by `resolveModelForFeature` when nothing in the scope chain nor a
 * built-in constant can produce a model for the requested feature. A
 * `HandledError` (HTTP 400): the REST error-handler middleware and the
 * generic tRPC `domainError` channel both recognize it automatically via
 * `HandledError.isHandled()`. The frontend `tRPC` interceptor additionally
 * matches on the historical `cause === MODEL_NOT_CONFIGURED` field (see
 * `server/api/trpc.ts`'s bespoke `missingModelCause` mapping) and opens the
 * missing-model modal with the role+feature in context.
 *
 * Carries enough state for the popup to render and deep-link:
 *   - featureKey: stable identifier of the feature that failed to resolve
 *   - role: which role (Default / Fast / Embeddings) had no model set
 *   - featureDisplayName: the user-facing copy from the registry
 *   - projectId: the project the resolve was called for, so the popup can
 *                deep-link the user back to the right settings page scope
 */
export class ModelNotConfiguredError extends HandledError {
  /**
   * Same value as `code`, kept under this historical field name because the
   * tRPC bespoke matcher (`server/api/trpc.ts`) and the frontend interceptor
   * (`utils/trpcError.ts::extractMissingModelInfo`) already key off
   * `error.cause.cause` / `cause.code` in production. New code should read
   * `code` instead.
   */
  public readonly cause = MODEL_NOT_CONFIGURED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly projectId: string,
  ) {
    super(
      MODEL_NOT_CONFIGURED_CAUSE,
      `No model configured for "${featureKey}" (role: ${role}, project: ${projectId}).`,
      {
        httpStatus: 400,
        meta: { featureKey, role, featureDisplayName, projectId },
      },
    );
    this.name = "ModelNotConfiguredError";
  }
}
