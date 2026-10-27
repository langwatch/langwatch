/**
 * @vitest-environment jsdom
 * specs/model-providers/missing-model-popup.feature: the model-provider declaration installs
 * one reader over every failed mutation, and that reader raises main's toasts by cause code.
 */

import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { installedModuleFailures } from "@langwatch/browser/application";
import type { UiFailureHost } from "@langwatch/browser/feature-install";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelProviderWeb } from "../../../../model-provider.web.ts";
import { reportModelFailure } from "../model-failure-interceptor.ts";

/** A failed call as the tRPC client hands it over: an Error carrying the serialised `data`. */
function failedCall({ data }: { data: Record<string, unknown> }): Error {
  return Object.assign(new Error("refused"), { data });
}

const mutate = vi.fn(async (_path: string, _input: unknown): Promise<unknown> => ({ ok: true }));

function failureHost(): UiFailureHost {
  return { rpc: { query: vi.fn(), mutate, subscribe: vi.fn() }, navigate: vi.fn() };
}

beforeEach(() => {
  toaster.remove();
  mutate.mockClear();
  renderWithDesignSystem(<Toaster />);
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

describe("Feature: Missing-model toast when a feature can't resolve a model", () => {
  it("installs reportModelFailure as the module's failure interceptor", () => {
    expect(installedModuleFailures([modelProviderWeb])).toEqual([reportModelFailure]);
  });

  /** @scenario A tRPC call that throws ModelNotConfigured opens the toast */
  it("A tRPC call that throws ModelNotConfigured opens the toast", async () => {
    const error = failedCall({
      data: {
        code: "BAD_REQUEST",
        error: { code: "model_not_configured" },
        cause: {
          code: "MODEL_NOT_CONFIGURED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
          projectId: "project-1",
        },
      },
    });

    expect(reportModelFailure(error, failureHost())).toBe(true);

    expect(await screen.findByText("Model not configured for AI search")).toBeInTheDocument();
    expect(isHandledByGlobalHandler(error)).toBe(true);
  });

  it("Downstream AI failures surface a hint to verify model configuration", async () => {
    const error = failedCall({
      data: {
        code: "BAD_GATEWAY",
        error: { code: "ai_call_failed" },
        cause: {
          code: "AI_CALL_FAILED",
          featureKey: "workflows.commit_message",
          featureDisplayName: "Workflow commit message",
          role: "FAST",
        },
      },
    });

    expect(reportModelFailure(error, failureHost())).toBe(true);

    expect(await screen.findByText("Workflow commit message failed")).toBeInTheDocument();
    expect(
      screen.getByText("Double-check your Fast model configuration in Model Providers."),
    ).toBeInTheDocument();
  });

  it("Project-scope override with disabled provider and an org alternate", async () => {
    const error = failedCall({
      data: {
        code: "BAD_REQUEST",
        error: { code: "model_provider_disabled" },
        cause: {
          code: "MODEL_PROVIDER_DISABLED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
          projectId: "project-1",
          resolvedScope: "project",
          resolvedModel: "openai/gpt-4o",
          providerKey: "openai",
          alternate: {
            scope: "organization",
            model: "azure/gpt-4o",
            providerKey: "azure",
            providerEnabled: true,
          },
        },
      },
    });

    expect(reportModelFailure(error, failureHost())).toBe(true);
    expect(isHandledByGlobalHandler(error)).toBe(true);
    expect(await screen.findByText("Model unavailable for AI search")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Use organization default (azure/gpt-4o)" }),
    );

    expect(mutate).toHaveBeenCalledWith("modelProvider.setFeatureOverrideForScope", {
      scopeType: "PROJECT",
      scopeId: "project-1",
      featureKey: "traces.ai_search",
      model: null,
    });
  });

  it("A refusal the model provider does not explain is left to the screen", () => {
    const error = failedCall({
      data: {
        code: "FORBIDDEN",
        error: { code: "resource_limit_exceeded" },
        cause: { limitType: "members", current: 5, max: 5 },
      },
    });

    expect(reportModelFailure(error, failureHost())).toBe(false);
    expect(isHandledByGlobalHandler(error)).toBe(false);
  });
});
