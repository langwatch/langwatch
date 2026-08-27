import { HandledError } from "@langwatch/handled-error";
import { remediation } from "../app-layer/error-remediation";
import type { ModelRole } from "./featureRegistry";

/**
 * Legacy wire-format discriminator carried on the tRPC `data.cause` sidecar.
 *
 * @deprecated NOT the error's code — the code is `model_not_configured`, which
 * is what `APP_ERROR_CODES` enumerates and what the presentation registry
 * writes copy for. This constant survives for exactly one consumer:
 * `src/utils/trpcError.ts::extractMissingModelInfo`, which matches
 * `data.cause.code === "MODEL_NOT_CONFIGURED"` to open the missing-model
 * toast, and is fed by the bespoke `missingModelCause` block in
 * `src/server/api/trpc.ts`. New code reads `error.code` instead. Remove this
 * once that interceptor keys off the handled payload.
 */
export const MODEL_NOT_CONFIGURED_CAUSE = "MODEL_NOT_CONFIGURED" as const;

/**
 * Thrown by `resolveModelForFeature` when nothing in the scope chain nor a
 * built-in constant can produce a model for the requested feature. A
 * `HandledError` (HTTP 400) with the enumerated code `model_not_configured`,
 * so the REST error-handler middleware and the generic tRPC `domainError`
 * channel both recognize it via `HandledError.isHandled()` and the client
 * takes its words from the code-keyed presentation registry. The frontend
 * `tRPC` interceptor additionally matches on the historical
 * `cause === MODEL_NOT_CONFIGURED` field (see `server/api/trpc.ts`'s bespoke
 * `missingModelCause` mapping) and opens the missing-model toast with the
 * role+feature in context.
 *
 * Carries enough state for the popup to render and deep-link:
 *   - featureKey: stable identifier of the feature that failed to resolve
 *   - role: which role (Default / Fast / Embeddings) had no model set
 *   - featureDisplayName: the user-facing copy from the registry
 *   - projectId: the project the resolve was called for, so the popup can
 *                deep-link the user back to the right settings page scope
 */
export class ModelNotConfiguredError extends HandledError {
  declare readonly code: "model_not_configured";

  /**
   * @deprecated The legacy alias of `code`, kept under this historical field
   * name for its one consumer: the frontend interceptor
   * `utils/trpcError.ts::extractMissingModelInfo`, reached via the bespoke
   * `missingModelCause` mapping in `server/api/trpc.ts`. New code reads
   * `code` (`model_not_configured`) instead.
   */
  public readonly cause = MODEL_NOT_CONFIGURED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly projectId: string,
  ) {
    super(
      "model_not_configured",
      `No model configured for "${featureKey}" (role: ${role}, project: ${projectId}).`,
      {
        httpStatus: 400,
        meta: { featureKey, role, featureDisplayName, projectId },
        // Names the settings page and the scope to set it at. A caller with no
        // UI (CLI, MCP, an agent driving the API) has nothing else to go on,
        // and "no model configured" alone does not say where the setting is.
        ...remediation("model_not_configured"),
      },
    );
    this.name = "ModelNotConfiguredError";
  }
}
