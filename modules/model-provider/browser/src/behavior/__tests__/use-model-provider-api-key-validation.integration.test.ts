/**
 * @vitest-environment jsdom
 *
 * Verifies the API key travels as a mutation, not a tRPC query — a GET would encode
 * it into the URL, where access logs, proxies and browser history can catch it.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMutateAsync, mockQueryFetch } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockQueryFetch: vi.fn(),
}));

vi.mock("../model-provider-api.ts", () => ({
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

import { useModelProviderApiKeyValidation } from "../use-model-provider-api-key-validation.ts";

const renderValidation = () =>
  renderHook(() =>
    useModelProviderApiKeyValidation({
      provider: "gemini",
      customKeys: { GEMINI_API_KEY: "AIzaSyTheCustomersKey" },
      projectId: undefined,
      organizationId: "org-1",
      scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    }),
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

      // The regression this pins is invisible server-side: the sentence the
      // constructor writes is real there, and only the wire replaces it with
      // the code. So the payload the probe adapter serialises is driven
      // through the genuine hook, and what the drawer would render is read
      // back off it.
      /** @scenario An unreachable provider is explained, not named by its code */
      it("explains an unreachable provider instead of showing its error code", async () => {
        mockMutateAsync.mockRejectedValue({
          data: {
            error: {
              code: "provider_unreachable",
              httpStatus: 502,
              fault: "provider",
              meta: { provider: "gemini", hasConfigurableEndpoint: true },
              tips: [
                "Check your network connection.",
                "Check the base URL is correct and reachable.",
              ],
            },
          },
        });
        const { result } = renderValidation();

        await act(async () => {
          await result.current.validate();
        });

        expect(result.current.validationError).toBe(
          "Couldn't reach the provider. " +
            "Nothing answered, so this API key was not checked. " +
            "Check your network connection, and check the base URL is " +
            "correct and reachable.",
        );
        // The defect was this slug reaching the customer verbatim.
        expect(result.current.validationError).not.toContain("provider_unreachable");
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
        useModelProviderApiKeyValidation({
          provider: "gemini",
          customKeys: { GEMINI_API_KEY: "AIzaSyTheCustomersKey" },
          projectId: undefined,
          organizationId: undefined,
        }),
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
