import { HandledError } from "@langwatch/handled-error";
import { ROUTING_HANDLE_RULE } from "./model-provider";

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
    super(
      "model_provider_deprecated",
      "This model provider is no longer available to add.",
      {
        meta: input.replacement
          ? { provider: input.provider, replacement: input.replacement }
          : { provider: input.provider },
        httpStatus: 400,
        fault: "customer",
      },
    );
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
