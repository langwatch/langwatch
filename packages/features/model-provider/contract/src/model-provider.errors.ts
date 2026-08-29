import { HandledError } from "@langwatch/handled-error";
import { ROUTING_HANDLE_RULE } from "./model-provider";
import type { ModelRole } from "./catalog/model-feature-registry";
import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "./catalog/codex-refusal-message";

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
 * A credential that names a project but nobody in it tried to write a default.
 *
 * Not a permission refusal like {@link ModelDefaultScopeForbiddenError}: the
 * caller may well be allowed, but the key does not say who they are, so there
 * is nobody to check. 403 rather than 401 because the request IS
 * authenticated — telling an API caller they are not sends them to inspect a
 * key that is working, which is the confusion this error was written to end.
 *
 * Only an API or CLI caller can reach it, so the copy names the two ways out
 * rather than sending them to an admin.
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
