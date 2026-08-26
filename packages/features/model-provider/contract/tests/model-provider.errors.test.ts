import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  ModelCostNotFoundError,
  ModelDefaultNotFoundError,
  ModelDefaultScopeForbiddenError,
  ModelDefaultValidationError,
  ModelProviderAnchorRequiredError,
  ModelProviderCredentialsUnreadableError,
  ModelProviderCredentialsWouldBeDroppedError,
  ModelProviderDeprecatedError,
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleInvalidError,
  ModelProviderRoutingHandleTakenError,
  ModelProviderScopeForbiddenError,
  ModelProviderScopesRequiredError,
  ModelProviderTestRateLimitedError,
} from "../src/model-provider.errors";

function expectHandledWire(
  error: HandledError,
  input: {
    code: string;
    message: string;
    httpStatus: number;
    meta?: Record<string, unknown>;
  },
): void {
  expect(error.message).toBe(input.message);
  expect(error.serialize()).toMatchObject({
    code: input.code,
    httpStatus: input.httpStatus,
    fault: "customer",
    retryable: false,
    meta: input.meta ?? {},
  });
}

describe("model provider handled errors", () => {
  it("preserves provider write, routing, and connection error wires", () => {
    expectHandledWire(new ModelProviderInvalidError("Unknown provider: legacy"), {
      code: "model_provider_invalid",
      message: "Unknown provider: legacy",
      httpStatus: 400,
    });
    expectHandledWire(new ModelProviderNotFoundError(), {
      code: "model_provider_not_found",
      message: "Model provider not found",
      httpStatus: 404,
    });
    expectHandledWire(new ModelProviderAnchorRequiredError("project_or_organization"), {
      code: "model_provider_anchor_required",
      message: "Say which project or organization this model provider applies to.",
      httpStatus: 400,
      meta: { requires: "project_or_organization" },
    });
    expectHandledWire(new ModelProviderScopesRequiredError(), {
      code: "model_provider_scopes_required",
      message: "A model provider created without a project must declare its scopes",
      httpStatus: 400,
    });
    expectHandledWire(new ModelProviderDeprecatedError({ provider: "legacy" }), {
      code: "model_provider_deprecated",
      message: "This model provider is no longer available to add.",
      httpStatus: 400,
      meta: { provider: "legacy" },
    });
    expectHandledWire(
      new ModelProviderScopeForbiddenError({
        scopeType: "TEAM",
        requiredPermission: "team:manage",
      }),
      {
        code: "model_provider_scope_forbidden",
        message: "You don't have permission to manage model providers here.",
        httpStatus: 403,
        meta: { scopeType: "TEAM", requiredPermission: "team:manage" },
      },
    );
    expectHandledWire(new ModelProviderTestRateLimitedError({ retryAfterSeconds: 12 }), {
      code: "model_provider_test_rate_limited",
      message: "Too many connection tests. Wait a moment and try again.",
      httpStatus: 429,
      meta: { retryAfterSeconds: 12 },
    });
    expectHandledWire(
      new ModelProviderRoutingHandleInvalidError({
        handle: "Open Router",
        problem: "shape",
      }),
      {
        code: "model_provider_routing_handle_invalid",
        message:
          "That routing handle is not a valid name. A routing handle starts with a letter or a number, then uses only letters, numbers, hyphens and underscores, up to 32 characters.",
        httpStatus: 400,
        meta: { handle: "Open Router", problem: "shape" },
      },
    );
    expectHandledWire(new ModelProviderRoutingHandleTakenError({ handle: "eu" }), {
      code: "model_provider_routing_handle_taken",
      message:
        "Another model provider in this organization already uses that routing handle. Choose a different name.",
      httpStatus: 409,
      meta: { handle: "eu" },
    });
  });

  it("preserves default and credential refusal wires", () => {
    expectHandledWire(
      new ModelDefaultScopeForbiddenError({
        scopeType: "ORGANIZATION",
        requiredPermission: "organization:manage",
      }),
      {
        code: "model_default_scope_forbidden",
        message: "You don't have permission to manage default models here.",
        httpStatus: 403,
        meta: {
          scopeType: "ORGANIZATION",
          requiredPermission: "organization:manage",
        },
      },
    );
    expectHandledWire(new ModelProviderCredentialsWouldBeDroppedError("azure"), {
      code: "model_provider_credentials_would_be_dropped",
      message:
        "This save would delete the credentials already stored for this provider. Send the credentials with it, or leave them out of the request entirely to keep them.",
      httpStatus: 400,
      meta: { provider: "azure" },
    });
    expectHandledWire(new ModelProviderCredentialsUnreadableError("azure"), {
      code: "model_provider_credentials_unreadable",
      message:
        "The credentials stored for this provider cannot be read, so this save would replace them with nothing. Type a new credential and save again.",
      httpStatus: 400,
      meta: { provider: "azure" },
    });
    expectHandledWire(new ModelDefaultNotFoundError(), {
      code: "model_default_not_found",
      message: "Model default not found",
      httpStatus: 404,
    });
    expectHandledWire(new ModelDefaultValidationError("Pick at least one model."), {
      code: "validation_error",
      message: "Pick at least one model.",
      httpStatus: 422,
    });
    expectHandledWire(new ModelCostNotFoundError(), {
      code: "model_cost_not_found",
      message: "Model cost not found",
      httpStatus: 404,
    });
  });
});
