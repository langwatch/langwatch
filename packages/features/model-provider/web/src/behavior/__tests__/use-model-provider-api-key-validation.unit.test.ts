/**
 * @vitest-environment jsdom
 *
 * The transport matters as much as the result here. tRPC sends queries as GET
 * with their input encoded into the URL, and the input is the customer's API
 * key — which lands in access logs, proxy logs and browser history, and gets
 * stripped by proxies that filter credential-shaped query parameters, leaving
 * the server parsing an absent input. Every drawer test mocks this hook away,
 * so nothing else observes which call it makes.
 *
 * Covers @unit scenarios from
 * specs/model-providers/credential-validation.feature.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMutateAsync, mockQueryFetch } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockQueryFetch: vi.fn(),
}));

vi.mock("../model-provider-api", () => ({
  api: {
    modelProvider: {
      validateApiKey: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
    },
    useUtils: () => ({
      modelProvider: {
        // Present so a regression back to the query transport would be
        // silently satisfied rather than throwing — the test has to catch
        // it by observing which one was called.
        validateApiKey: { fetch: mockQueryFetch },
        validateKeyWithCustomUrl: { fetch: vi.fn() },
      },
    }),
  },
}));

import { useModelProviderApiKeyValidation } from "../use-model-provider-api-key-validation";

const renderValidation = () =>
  renderHook(() =>
    useModelProviderApiKeyValidation(
      "gemini",
      { GEMINI_API_KEY: "AIzaSyTheCustomersKey" },
      undefined,
      "org-1",
      [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    ),
  );

describe("useModelProviderApiKeyValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ valid: true });
  });

  describe("given a key to check", () => {
    describe("when validation runs", () => {
      /** @scenario The API key is never sent in a URL */
      it("sends the key in a request body, never as a query", async () => {
        const { result } = renderValidation();

        await act(async () => {
          await result.current.validate();
        });

        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: "gemini",
            customKeys: { GEMINI_API_KEY: "AIzaSyTheCustomersKey" },
          }),
        );
        // A query would put the key in the URL. That is the defect.
        expect(mockQueryFetch).not.toHaveBeenCalled();
      });

      it("surfaces a thrown request as an error rather than a pass", async () => {
        mockMutateAsync.mockRejectedValue(new Error("Failed to fetch"));
        const { result } = renderValidation();

        let valid: boolean | undefined;
        await act(async () => {
          valid = await result.current.validate();
        });

        expect(valid).toBe(false);
        // An error with no handled payload says nothing about what broke
        // (ADR-045), so the customer reads the generic line rather than a
        // string thrown by the transport.
        expect(result.current.validationError).toBeTruthy();
        expect(result.current.validationError).not.toContain("Failed to fetch");
      });
    });
  });

  describe("given neither a project nor an organization", () => {
    /**
     * The probe is authorized against a tenant, so with neither the request
     * would be rejected server-side. Failing before the request keeps the
     * key off the wire entirely.
     */
    it("refuses to send the key anywhere", async () => {
      const { result } = renderHook(() =>
        useModelProviderApiKeyValidation(
          "gemini",
          { GEMINI_API_KEY: "AIzaSyTheCustomersKey" },
          undefined,
          undefined,
        ),
      );

      let valid: boolean | undefined;
      await act(async () => {
        valid = await result.current.validate();
      });

      expect(valid).toBe(false);
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });
});
