import { HandledError, remediation } from "@langwatch/handled-error";

import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "./catalog/codex-refusal-message.ts";
import type { ModelRole } from "./catalog/model-feature-registry.ts";
import { ROUTING_HANDLE_RULE } from "./model-provider.ts";

export const MODEL_NOT_CONFIGURED_CAUSE = "MODEL_NOT_CONFIGURED" as const;

export class ModelNotConfiguredError extends HandledError {
  declare readonly code: "model_not_configured";
  readonly cause = MODEL_NOT_CONFIGURED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly projectId: string,
  ) {
    super(
      "model_not_configured",
      `No model configured for "${featureKey}" (role: ${role}, project: ${projectId}).`,
      { httpStatus: 400, meta: { featureKey, role, featureDisplayName, projectId } },
    );
    this.name = "ModelNotConfiguredError";
  }
}

export const MODEL_PROVIDER_DISABLED_CAUSE = "MODEL_PROVIDER_DISABLED" as const;

export type ModelProviderResolvedAlternate = {
  scope: "project" | "team" | "organization";
  model: string;
  providerKey: string;
  providerEnabled: boolean;
};

export class ModelProviderDisabledError extends HandledError {
  declare readonly code: "model_provider_disabled";
  readonly cause = MODEL_PROVIDER_DISABLED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly featureDisplayName: string,
    public readonly role: ModelRole,
    public readonly projectId: string,
    public readonly resolvedScope: "project" | "team" | "organization",
    public readonly resolvedModel: string,
    public readonly providerKey: string,
    public readonly alternate: ModelProviderResolvedAlternate | null,
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

  toResponseBody(): {
    code: typeof MODEL_PROVIDER_DISABLED_CAUSE;
    featureKey: string;
    featureDisplayName: string;
    role: ModelRole;
    projectId: string;
    resolvedScope: "project" | "team" | "organization";
    resolvedModel: string;
    providerKey: string;
    alternate: ModelProviderResolvedAlternate | null;
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

export class ModelRestrictedForFeatureError extends HandledError {
  declare readonly code: "model_restricted_for_feature";

  readonly featureKey: string;
  readonly role: ModelRole;
  readonly featureDisplayName: string;
  readonly projectId: string;
  readonly restrictedModels: readonly string[];

  constructor(input: {
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
    projectId: string;
    restrictedModels: readonly string[];
  }) {
    const { featureKey, role, featureDisplayName, projectId, restrictedModels } = input;
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
    this.featureKey = featureKey;
    this.role = role;
    this.featureDisplayName = featureDisplayName;
    this.projectId = projectId;
    this.restrictedModels = restrictedModels;
  }
}

/**
 * Same licence rule as {@link ModelRestrictedForFeatureError}, caught at execution
 * instead of selection — a separate code because the remedy differs (a saved value
 * predating the restriction, not a feature default to change).
 */
export class ModelRestrictedForExecutionError extends HandledError {
  declare readonly code: "model_restricted_for_execution";

  readonly model: string;
  readonly provider: string | null;
  readonly featureKey: string | null;

  constructor(input: { model: string; provider: string | null; featureKey?: string }) {
    const featureKey = input.featureKey ?? null;
    super(
      "model_restricted_for_execution",
      // Two wordings, because the two paths know different things. The
      // gateway is running one named feature; the litellm path is preparing
      // parameters and knows only that this is not a coding-assistant
      // surface. Both are pinned by the scenario classifier's tests.
      featureKey
        ? `"${input.model}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot run "${featureKey}".`
        : `"${input.model}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot run workflows, evaluations or the playground.`,
      {
        httpStatus: 400,
        meta: {
          model: input.model,
          provider: input.provider,
          ...(featureKey ? { featureKey } : {}),
        },
      },
    );
    this.name = "ModelRestrictedForExecutionError";
    this.model = input.model;
    this.provider = input.provider;
    this.featureKey = featureKey;
  }
}

export class ModelProviderNotFoundError extends HandledError {
  declare readonly code: "model_provider_not_found";

  constructor() {
    super("model_provider_not_found", "Model provider not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ModelProviderNotFoundError";
  }
}

export class ModelProviderInvalidError extends HandledError {
  declare readonly code: "model_provider_invalid";

  constructor(message = "Invalid model provider") {
    super("model_provider_invalid", message, {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ModelProviderInvalidError";
  }
}

export class ModelProviderScopesRequiredError extends HandledError {
  declare readonly code: "model_provider_scopes_required";

  constructor() {
    super(
      "model_provider_scopes_required",
      "A model provider created without a project must declare its scopes",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderScopesRequiredError";
  }
}

export class ModelProviderAnchorRequiredError extends HandledError {
  declare readonly code: "model_provider_anchor_required";

  constructor(requires: "project_or_organization" | "project") {
    super(
      "model_provider_anchor_required",
      "Say which project or organization this model provider applies to.",
      { meta: { requires }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderAnchorRequiredError";
  }
}

export class ModelProviderScopeForbiddenError extends HandledError {
  declare readonly code: "model_provider_scope_forbidden";

  constructor(input: { scopeType: string; requiredPermission: string }) {
    super(
      "model_provider_scope_forbidden",
      "You don't have permission to manage model providers here.",
      { meta: input, httpStatus: 403, fault: "customer" },
    );
    this.name = "ModelProviderScopeForbiddenError";
  }
}

export class ModelProviderDeprecatedError extends HandledError {
  declare readonly code: "model_provider_deprecated";

  constructor(input: { provider: string; replacement?: string }) {
    super("model_provider_deprecated", "This model provider is no longer available to add.", {
      meta: input.replacement
        ? { provider: input.provider, replacement: input.replacement }
        : { provider: input.provider },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ModelProviderDeprecatedError";
  }
}

export class ModelProviderRoutingHandleInvalidError extends HandledError {
  declare readonly code: "model_provider_routing_handle_invalid";

  constructor(input: { handle: string; problem: "shape" | "reserved" }) {
    super(
      "model_provider_routing_handle_invalid",
      input.problem === "reserved"
        ? "That routing handle already names a provider type, so requests using it would be ambiguous. Choose a different name."
        : `That routing handle is not a valid name. ${ROUTING_HANDLE_RULE}`,
      { meta: input, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderRoutingHandleInvalidError";
  }
}

export class ModelProviderRoutingHandleTakenError extends HandledError {
  declare readonly code: "model_provider_routing_handle_taken";

  constructor(input: { handle: string }) {
    super(
      "model_provider_routing_handle_taken",
      "Another model provider in this organization already uses that routing handle. Choose a different name.",
      { meta: input, httpStatus: 409, fault: "customer" },
    );
    this.name = "ModelProviderRoutingHandleTakenError";
  }
}

export class ModelProviderTestRateLimitedError extends HandledError {
  declare readonly code: "model_provider_test_rate_limited";

  constructor(input: { retryAfterSeconds: number }) {
    super(
      "model_provider_test_rate_limited",
      "Too many connection tests. Wait a moment and try again.",
      { meta: input, httpStatus: 429, fault: "customer" },
    );
    this.name = "ModelProviderTestRateLimitedError";
  }
}

export class ModelProviderCredentialsWouldBeDroppedError extends HandledError {
  declare readonly code: "model_provider_credentials_would_be_dropped";

  constructor(provider: string) {
    super(
      "model_provider_credentials_would_be_dropped",
      "This save would delete the credentials already stored for this provider. Send the credentials with it, or leave them out of the request entirely to keep them.",
      { meta: { provider }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderCredentialsWouldBeDroppedError";
  }
}

export class ModelProviderCredentialsUnreadableError extends HandledError {
  declare readonly code: "model_provider_credentials_unreadable";

  constructor(provider: string) {
    super(
      "model_provider_credentials_unreadable",
      "The credentials stored for this provider cannot be read, so this save would replace them with nothing. Type a new credential and save again.",
      { meta: { provider }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderCredentialsUnreadableError";
  }
}

/**
 * A pattern that doesn't compile matches nothing, so storing it would silently leave
 * the operator's model untrusted; the whole save is refused instead. `meta.fieldErrors`
 * routes the refusal onto the drawer's textarea rather than a toast.
 */
export class ModelProviderSkipPermissionsPatternInvalidError extends HandledError {
  declare readonly code: "model_provider_skip_permissions_pattern_invalid";

  constructor({ line, pattern }: { line: number; pattern: string }) {
    super(
      "model_provider_skip_permissions_pattern_invalid",
      `Line ${line} of the allowed models list is not a valid pattern.`,
      {
        meta: {
          line,
          pattern,
          fieldErrors: {
            langySkipPermissionsModels: [`Line ${line} is not a valid pattern.`],
          },
        },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "ModelProviderSkipPermissionsPatternInvalidError";
  }
}

export class ModelDefaultNotFoundError extends HandledError {
  declare readonly code: "model_default_not_found";

  constructor() {
    super("model_default_not_found", "Model default not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ModelDefaultNotFoundError";
  }
}

export class ModelDefaultScopeForbiddenError extends HandledError {
  declare readonly code: "model_default_scope_forbidden";

  constructor(input: { scopeType: string; requiredPermission: string }) {
    super(
      "model_default_scope_forbidden",
      "You don't have permission to manage default models here.",
      { meta: input, httpStatus: 403, fault: "customer" },
    );
    this.name = "ModelDefaultScopeForbiddenError";
  }
}

/**
 * A project-scoped key with no user attached to check permission for. 403 not 401 —
 * the request IS authenticated, it just names nobody, and 401 would send a caller to
 * inspect a working key.
 */
export class ModelDefaultUserKeyRequiredError extends HandledError {
  declare readonly code: "model_default_user_key_required";

  constructor() {
    super(
      "model_default_user_key_required",
      "Default models are set per user, and this API key is not tied to one. Use a user API key, or change the default in settings.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "ModelDefaultUserKeyRequiredError";
  }
}

/** Keeps the established default-model validation envelope at the service boundary. */
export class ModelDefaultValidationError extends HandledError {
  declare readonly code: "validation_error";

  constructor(message: string) {
    super("validation_error", message, { httpStatus: 422, fault: "customer" });
    this.name = "ModelDefaultValidationError";
  }
}

export class ModelCostNotFoundError extends HandledError {
  declare readonly code: "model_cost_not_found";

  constructor() {
    super("model_cost_not_found", "Model cost not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ModelCostNotFoundError";
  }
}

/**
 * The cost-rule preview was asked for on a process that composed no span
 * reader. It says so rather than answering "no matching spans", which would
 * talk somebody out of a rule that works.
 */
export class ModelCostPreviewUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: "the cost rule's span preview" },
    });
    this.name = "ModelCostPreviewUnavailableError";
  }
}

/** The provider positively identified the credential itself as wrong. */
export class ProviderKeyInvalidError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_key_invalid", `${provider} rejected the API key`, {
      fault: "customer",
      httpStatus: 400,
      meta: { provider },
    });
  }
}

/** The credential is fine; the API it needs is switched off for its project. */
export class ProviderServiceDisabledError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_service_disabled", `${provider} reports the required API is not enabled`, {
      fault: "customer",
      httpStatus: 403,
      meta: { provider },
      tips: [
        "Enable the Generative Language API in the Google Cloud console.",
        "Or configure a Vertex AI provider, which uses service-account credentials.",
      ],
    });
  }
}

/**
 * The credential exists but its own restrictions refuse this call.
 */
export class ProviderKeyRestrictedError extends HandledError {
  constructor({
    provider,
    reason,
    googleDoor,
  }: {
    provider: string;
    reason: string;
    /**
     * Which Google door refused — the same `API_KEY_SERVICE_BLOCKED` reason means
     * opposite remediations on the two doors (fill in the project/location pair vs
     * clear it), so the presentation registry branches on this.
     */
    googleDoor?: "gemini-api" | "agent-platform";
  }) {
    super("provider_key_restricted", `${provider} refused the API key (${reason})`, {
      fault: "customer",
      httpStatus: 403,
      meta: { provider, reason, ...(googleDoor ? { googleDoor } : {}) },
      tips: ["Adjust the key's restrictions in the Google Cloud console."],
    });
  }
}

/**
 * The provider answered, refused, and did not say anything we can map.
 */
export class ProviderRefusedError extends HandledError {
  constructor({ provider, status }: { provider: string; status: number }) {
    super("provider_refused", `${provider} refused the credential check with ${status}`, {
      fault: "provider",
      httpStatus: 502,
      meta: { provider, status },
    });
  }
}

/** The account behind the credential cannot pay for a call. */
export class ProviderOutOfCreditError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_out_of_credit", `${provider} reports no credit left on the account`, {
      fault: "customer",
      httpStatus: 402,
      meta: { provider },
    });
  }
}

/** The plan behind the credential is over its allowance for now. */
export class ProviderUsageLimitError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_usage_limit_reached",
      `${provider} reports the plan's usage limit was reached`,
      {
        fault: "customer",
        httpStatus: 429,
        meta: { provider },
      },
    );
  }
}

/** There was no credential to check — nothing stored, nothing in the env. */
export class ProviderKeyMissingError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_key_missing", `No API key stored for ${provider}`, {
      fault: "customer",
      httpStatus: 400,
      meta: { provider },
    });
  }
}

/**
 * The endpoint answered with a redirect, and we will not follow it.
 */
export class ProviderEndpointRedirectedError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_endpoint_redirected",
      `The endpoint configured for ${provider} redirects elsewhere`,
      {
        fault: "customer",
        httpStatus: 400,
        meta: { provider },
        tips: [
          "Point the base URL at the address the provider actually serves.",
          "An http:// URL that redirects to https:// is the usual cause.",
        ],
      },
    );
    this.name = "ProviderEndpointRedirectedError";
  }
}

/**
 * The probe never reached the provider, so nothing was learned about the key.
 */
export class ProviderUnreachableError extends HandledError {
  constructor({
    provider,
    hasConfigurableEndpoint,
  }: {
    provider: string;
    hasConfigurableEndpoint: boolean;
  }) {
    const tips = hasConfigurableEndpoint
      ? ["Check your network connection.", "Check the base URL is correct and reachable."]
      : ["Check your network connection."];

    super("provider_unreachable", `Could not reach ${provider} to check the API key`, {
      fault: "provider",
      httpStatus: 502,
      // `hasConfigurableEndpoint` is in `meta` because the registry entry
      // branches on it: only some providers have a base URL there is any
      // point telling someone to check.
      meta: { provider, hasConfigurableEndpoint },
      tips,
    });
  }
}

/** HandledError so the sign-in UI shows `message` verbatim without logging an unhandled 500. */
export class CodexAuthError extends HandledError {
  /** The issuer's HTTP status for kind "http" — what separates an OAuth
   *  rejection (4xx + error body) from a retryable outage (5xx, network). */
  public readonly status?: number;

  constructor(
    public readonly kind: "http" | "malformed" | "timed_out" | "refresh_rejected",
    message: string,
    options?: { status?: number },
  ) {
    super("codex_auth_failed", message, {
      meta: { kind },
      fault: "provider",
      httpStatus: kind === "refresh_rejected" ? 401 : 502,
    });
    this.name = "CodexAuthError";
    this.status = options?.status;
  }
}

/**
 * Legacy wire-format discriminator carried on the tRPC `data.cause` sidecar.
 * @deprecated NOT the error's code — the code is `ai_call_failed`, which is
 */
export const AI_CALL_FAILED_CAUSE = "AI_CALL_FAILED" as const;

/**
 * Thrown when a downstream AI call fails for a reason that is NOT "no model is configured"
 * — the provider returned 401 on a stale key, the registered custom model id no longer
 * exists, the SDK threw parsing a malformed response.
 */
export class AiCallFailedError extends HandledError {
  declare readonly code: "ai_call_failed";

  /**
   * @deprecated The legacy alias of `code` — see {@link AI_CALL_FAILED_CAUSE}.
   */
  public readonly cause = AI_CALL_FAILED_CAUSE;

  readonly featureKey: string;
  readonly role: ModelRole;
  readonly featureDisplayName: string;
  /** The provider's / SDK's own sentence. */
  readonly originalErrorMessage: string;

  constructor({
    featureKey,
    role,
    featureDisplayName,
    originalErrorMessage,
  }: {
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
    originalErrorMessage: string;
  }) {
    super("ai_call_failed", `AI call failed for "${featureKey}".`, {
      httpStatus: 400,
      fault: "provider",
      // Read by the missing-model/AI-failure toast surface. Carried on the
      // handled payload (not only on the legacy `data.cause` sidecar) so the
      // bespoke `aiCallFailedCause` block in `trpc.ts` can be deleted without
      // the toast losing the feature it is talking about.
      meta: { featureKey, role, featureDisplayName },
    });
    this.name = "AiCallFailedError";
    this.featureKey = featureKey;
    this.role = role;
    this.featureDisplayName = featureDisplayName;
    this.originalErrorMessage = originalErrorMessage;
  }

  toResponseBody(): {
    cause: typeof AI_CALL_FAILED_CAUSE;
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
  } {
    return {
      cause: this.cause,
      featureKey: this.featureKey,
      role: this.role,
      featureDisplayName: this.featureDisplayName,
    };
  }
}

/** An evaluator's model setting names a provider or model this project cannot run it with. */
export class EvaluatorConfigError extends HandledError {
  declare readonly code: "evaluator_config_error";

  constructor(
    message: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super("evaluator_config_error", message, {
      httpStatus: 422,
      // `fault` decides whether evaluation processing reports a skip or an error.
      fault: "customer",
      ...remediation("evaluator_config_error"),
      ...options,
    });
    this.name = "EvaluatorConfigError";
  }
}
