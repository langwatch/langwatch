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

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      validateApiKey: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
    },
    useContext: () => ({
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

import { TRPCClientError } from "@trpc/client";
import {
  ProviderKeyRestrictedError,
  ProviderUnreachableError,
} from "../../server/api/routers/providerValidation";
import { errorFormatter } from "../../server/api/trpc";
import { useModelProviderApiKeyValidation } from "../useModelProviderApiKeyValidation";

/**
 * The error the browser actually receives, assembled by the real formatter
 * rather than described by hand. A handled error's free-text message is
 * replaced with its stable code on the wire (ADR-045), so a fixture written
 * from the constructor's message would test a shape that never travels.
 */
const wireErrorFor = (domainError: Error) =>
  TRPCClientError.from({
    error: errorFormatter({
      shape: {
        message: domainError.message,
        code: -32603,
        data: { code: "BAD_GATEWAY", httpStatus: 502 },
      },
      error: { cause: domainError, message: domainError.message },
    }),
  } as any);

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

      // A refusal arrives as a serialized handled error on the result, not as
      // a sentence and not as a throw, so the drawer's words come from the
      // code's registry entry. Built from the real error class rather than
      // hand-written, so a code with no entry fails here too.
      /** @scenario "A refusal is explained in our own words, not the provider's" */
      it("reports the provider's refusal to the caller", async () => {
        mockMutateAsync.mockResolvedValue({
          valid: false,
          domainError: new ProviderKeyRestrictedError({
            provider: "gemini",
            reason: "API_KEY_SERVICE_BLOCKED",
          }).serialize(),
        });
        const { result } = renderValidation();

        let valid: boolean | undefined;
        await act(async () => {
          valid = await result.current.validate();
        });

        expect(valid).toBe(false);
        expect(result.current.validationError).toBe(
          "This key's restrictions block the request. " +
            "Its API restrictions exclude the Generative Language API. " +
            "Allow that API in the Google Cloud console, or set up a " +
            "Vertex AI provider instead.",
        );
        expect(result.current.validationError).not.toContain(
          "provider_key_restricted",
        );
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
      // the code. So this drives the genuine error through the genuine
      // formatter into the genuine hook, and reads what the drawer would
      // render.
      /** @scenario An unreachable provider is explained, not named by its code */
      it("explains an unreachable provider instead of showing its error code", async () => {
        mockMutateAsync.mockRejectedValue(
          wireErrorFor(
            new ProviderUnreachableError({
              provider: "gemini",
              hasConfigurableEndpoint: true,
            }),
          ),
        );
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
        expect(result.current.validationError).not.toContain(
          "provider_unreachable",
        );
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
