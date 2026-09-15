/**
 * The application's answer to a model-resolution refusal, from a real transport
 * error to the toast. UX: specs/model-providers/missing-model-popup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UiFailureHost } from "../../../../behavior/ui-feature";
import { UiRpc, type UiRpcSubscription } from "../../../../behavior/ui-rpc";
import { modelProviderFailures } from "../model-provider-failures";

class RecordingRpc extends UiRpc {
  readonly mutations: { path: string; input: unknown }[] = [];

  query(): Promise<unknown> {
    return Promise.reject(new Error("not used"));
  }

  mutate(path: string, input: unknown): Promise<unknown> {
    this.mutations.push({ path, input });
    return Promise.resolve({ ok: true });
  }

  subscribe(): UiRpcSubscription {
    return { unsubscribe: () => undefined };
  }
}

function failedCall(cause: Record<string, unknown>): Error {
  const error = new TRPCClientError("Model not configured");
  (error as { data?: unknown }).data = { code: "BAD_REQUEST", cause };
  return error;
}

function hostWith(rpc: UiRpc): { host: UiFailureHost; navigate: ReturnType<typeof vi.fn> } {
  const navigate = vi.fn();
  return { host: { rpc, navigate }, navigate };
}

beforeEach(() => {
  toaster.remove();
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function mountToaster() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Toaster />
    </ChakraProvider>,
  );
}

describe("modelProviderFailures", () => {
  describe("when a call fails because no model is configured", () => {
    /** @scenario A tRPC call that throws ModelNotConfigured opens the toast */
    it("opens the missing-model toast and reports the failure as answered", async () => {
      mountToaster();
      const { host } = hostWith(new RecordingRpc());

      const answered = modelProviderFailures(
        failedCall({
          code: "MODEL_NOT_CONFIGURED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
          projectId: "project_abc",
        }),
        host,
      );

      expect(answered).toBe(true);
      await waitFor(() => {
        expect(screen.getByText("Model not configured for AI search")).toBeTruthy();
      });
    });

    it("navigates to the Fast role's settings when the reader takes the action", async () => {
      mountToaster();
      const { host, navigate } = hostWith(new RecordingRpc());

      modelProviderFailures(
        failedCall({
          code: "MODEL_NOT_CONFIGURED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
        }),
        host,
      );

      const action = await screen.findByText("Configure Fast model");
      fireEvent.click(action);
      expect(navigate).toHaveBeenCalledWith("/settings/model-providers#role-fast");
    });
  });

  describe("when the resolved model's provider is disabled at project scope", () => {
    it("offers the parent default and clears the project override on the swap", async () => {
      mountToaster();
      const rpc = new RecordingRpc();
      const { host } = hostWith(rpc);

      modelProviderFailures(
        failedCall({
          code: "MODEL_PROVIDER_DISABLED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
          projectId: "project_abc",
          resolvedScope: "project",
          resolvedModel: "openai/gpt-5-mini",
          providerKey: "openai",
          alternate: {
            scope: "organization",
            model: "anthropic/claude",
            providerKey: "anthropic",
            providerEnabled: true,
          },
        }),
        host,
      );

      const swap = await screen.findByText("Use organization default (anthropic/claude)");
      fireEvent.click(swap);
      await waitFor(() => {
        expect(rpc.mutations).toEqual([
          {
            path: "modelProvider.setFeatureOverrideForScope",
            input: {
              scopeType: "PROJECT",
              scopeId: "project_abc",
              featureKey: "traces.ai_search",
              model: null,
            },
          },
        ]);
      });
    });
  });

  describe("when the downstream AI call fails for another reason", () => {
    it("warns rather than errors, and points at the model configuration", async () => {
      mountToaster();
      const { host } = hostWith(new RecordingRpc());

      const answered = modelProviderFailures(
        failedCall({
          code: "AI_CALL_FAILED",
          featureKey: "workflows.commit_message",
          featureDisplayName: "Workflow commit messages",
          role: "FAST",
        }),
        host,
      );

      expect(answered).toBe(true);
      await waitFor(() => {
        expect(screen.getByText("Workflow commit messages failed")).toBeTruthy();
        expect(
          screen.getByText("Double-check your Fast model configuration in Model Providers."),
        ).toBeTruthy();
      });
    });
  });

  describe("when the failure has nothing to do with a model", () => {
    it("answers that it reported nothing, so the screen still can", () => {
      const { host } = hostWith(new RecordingRpc());
      expect(modelProviderFailures(new Error("network down"), host)).toBe(false);
      expect(modelProviderFailures(failedCall({ code: "LIMIT_EXCEEDED" }), host)).toBe(false);
    });
  });
});
