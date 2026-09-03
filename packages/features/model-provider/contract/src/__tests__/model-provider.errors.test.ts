import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  ModelCostNotFoundError,
  ModelDefaultNotFoundError,
  ModelDefaultScopeForbiddenError,
  ModelDefaultUserKeyRequiredError,
  ModelDefaultValidationError,
  ModelNotConfiguredError,
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
  ModelRestrictedForExecutionError,
  ModelRestrictedForFeatureError,
} from "../model-provider.errors";

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
    /**
     * @scenario Saving with a key that names no user is refused with a handled error
     *
     * 403 and not 401, deliberately. The request IS authenticated; telling an
     * API caller otherwise sends them to inspect a key that is working, which
     * is the exact confusion this error was written to end — `model-default
     * list` answered and `model-default set` said "HTTP 400: Not
     * authenticated" for the same key.
     */
    expectHandledWire(new ModelDefaultUserKeyRequiredError(), {
      code: "model_default_user_key_required",
      message:
        "Default models are set per user, and this API key is not tied to one. Use a user API key, or change the default in settings.",
      httpStatus: 403,
    });
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
    expectHandledWire(
      new ModelNotConfiguredError(
        "analytics.topic_clustering_embeddings",
        "EMBEDDINGS",
        "Topic clustering embeddings",
        "project_abc",
      ),
      {
        code: "model_not_configured",
        message:
          'No model configured for "analytics.topic_clustering_embeddings" (role: EMBEDDINGS, project: project_abc).',
        httpStatus: 400,
        meta: {
          featureKey: "analytics.topic_clustering_embeddings",
          role: "EMBEDDINGS",
          featureDisplayName: "Topic clustering embeddings",
          projectId: "project_abc",
        },
      },
    );
    expectHandledWire(
      new ModelRestrictedForFeatureError({
        featureKey: "prompt.create_default",
        role: "DEFAULT",
        featureDisplayName: "New prompt model",
        projectId: "project_abc",
        restrictedModels: ["openai_codex/gpt-5.6-terra"],
      }),
      {
        code: "model_restricted_for_feature",
        message:
          '"openai_codex/gpt-5.6-terra" serves the coding-assistant surfaces only and cannot be the model for "prompt.create_default".',
        httpStatus: 400,
        meta: {
          featureKey: "prompt.create_default",
          role: "DEFAULT",
          featureDisplayName: "New prompt model",
          projectId: "project_abc",
          restrictedModels: ["openai_codex/gpt-5.6-terra"],
        },
      },
    );
  });

  it("words the execution refusal for whichever path caught it", () => {
    // Both sentences are matched verbatim by the scenario infra-error
    // classifier, which turns them into simulation copy. They are one code
    // because the remedy is the same; they are two sentences because the
    // gateway knows the feature it was running and the litellm path does not.
    expectHandledWire(
      new ModelRestrictedForExecutionError({
        model: "openai_codex/gpt-5.6-terra",
        provider: null,
        featureKey: "prompt.create_default",
      }),
      {
        code: "model_restricted_for_execution",
        message:
          '"openai_codex/gpt-5.6-terra" serves the coding-assistant surfaces only and cannot run "prompt.create_default".',
        httpStatus: 400,
        meta: {
          model: "openai_codex/gpt-5.6-terra",
          provider: null,
          featureKey: "prompt.create_default",
        },
      },
    );
    expectHandledWire(
      new ModelRestrictedForExecutionError({
        model: "openai_codex/gpt-5.6-terra",
        provider: "openai_codex",
      }),
      {
        code: "model_restricted_for_execution",
        message:
          '"openai_codex/gpt-5.6-terra" serves the coding-assistant surfaces only and cannot run workflows, evaluations or the playground.',
        httpStatus: 400,
        meta: { model: "openai_codex/gpt-5.6-terra", provider: "openai_codex" },
      },
    );
  });
});
