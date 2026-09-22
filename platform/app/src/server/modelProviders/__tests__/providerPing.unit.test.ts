/**
 * The generation Test Connection sends, and what each way it can fail is
 * reported as.
 *
 * Spec: specs/model-providers/credential-validation.feature ("Testing a
 * credential that is already saved").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

const nlpgoHandleMock = vi.fn(async () => "nlpgo-handle");
vi.mock("../modelHandle", () => ({
  nlpgoModelHandle: (...args: unknown[]) => nlpgoHandleMock(...(args as [])),
}));

const codexHandleMock = vi.fn(async () => "codex-handle");
vi.mock("../codexGatewayModel", () => ({
  getCodexVercelAIModel: (...args: unknown[]) =>
    codexHandleMock(...(args as [])),
}));

import { CONNECTION_TEST_FEATURE_KEY } from "../codexRestrictions";
import { pingModelOf, pingModelProvider } from "../providerPing";
import type { MaybeStoredModelProvider } from "../registry";

const row = (
  overrides: Partial<MaybeStoredModelProvider> = {},
): MaybeStoredModelProvider =>
  ({
    id: "mp_1",
    provider: "openai",
    enabled: true,
    customKeys: { OPENAI_API_KEY: "sk-secret-key" },
    models: null,
    customModels: null,
    ...overrides,
  }) as MaybeStoredModelProvider;

/** The code the refusal carried, read the way the client reads it. */
function refusedCode(result: Awaited<ReturnType<typeof pingModelProvider>>) {
  if (result?.outcome !== "refused") {
    throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  }
  return result.domainError.code;
}

/** An AI SDK call failure, as the provider hands it back. */
function apiError({ statusCode, body }: { statusCode?: number; body: string }) {
  return Object.assign(new Error(body), { statusCode, responseBody: body });
}

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({ text: "ok" });
  nlpgoHandleMock.mockClear();
  codexHandleMock.mockClear();
});

describe("given a chat provider", () => {
  describe("when the model to ping is picked", () => {
    /** @scenario "A chat provider is proven by a generation, not by a listing" */
    it("takes the cheapest chat model the catalogue lists for it", () => {
      const model = pingModelOf(row());
      expect(model).toBeTruthy();
      expect(model).not.toContain("/");
    });

    it("falls to the row's own custom model when the catalogue knows none", () => {
      expect(
        pingModelOf(
          row({
            provider: "custom",
            models: [],
            customModels: [
              {
                modelId: "my-llama",
                displayName: "My Llama",
                mode: "chat",
              },
            ],
          }),
        ),
      ).toBe("my-llama");
    });
  });

  describe("when the generation succeeds", () => {
    /** @scenario "A chat provider is proven by a generation, not by a listing" */
    it("reports the connection as verified, having sent one token", async () => {
      const result = await pingModelProvider({
        modelProvider: row(),
        projectId: "project-1",
      });
      expect(result).toEqual({ outcome: "verified", valid: true });
      expect(generateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 1, maxRetries: 0 }),
      );
      // The row handed over is the one asked about, not a lookup by provider
      // key that another row of the same provider could win.
      expect(nlpgoHandleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          modelProvider: expect.objectContaining({ id: "mp_1" }),
        }),
      );
    });
  });

  describe("when the account has no credit", () => {
    /** @scenario "An account with no credit left is reported as out of credit" */
    it("says the account is out of credit", async () => {
      generateTextMock.mockRejectedValue(
        apiError({
          statusCode: 429,
          body: "You have no credits remaining. Add credits to continue using the API.",
        }),
      );
      const result = await pingModelProvider({
        modelProvider: row(),
        projectId: "project-1",
      });
      expect(refusedCode(result)).toBe("provider_out_of_credit");
    });
  });

  describe("when the plan is over its usage limit", () => {
    /** @scenario "A plan over its usage limit is reported as such" */
    it("says the plan is over its limit rather than blaming the key", async () => {
      generateTextMock.mockRejectedValue(
        apiError({ statusCode: 429, body: '{"type":"usage_limit_reached"}' }),
      );
      const result = await pingModelProvider({
        modelProvider: row(),
        projectId: "project-1",
      });
      expect(refusedCode(result)).toBe("provider_usage_limit_reached");
    });
  });

  describe("when the credential is refused", () => {
    it("says the key was refused, without quoting the provider", async () => {
      generateTextMock.mockRejectedValue(
        apiError({
          statusCode: 401,
          body: "Incorrect API key provided: sk-secret-key",
        }),
      );
      const result = await pingModelProvider({
        modelProvider: row(),
        projectId: "project-1",
      });
      expect(refusedCode(result)).toBe("provider_key_invalid");
      expect(JSON.stringify(result)).not.toContain("sk-secret-key");
    });
  });

  describe("when the provider refuses for a reason we cannot place", () => {
    it("attributes it to the provider", async () => {
      generateTextMock.mockRejectedValue(
        apiError({
          statusCode: 400,
          body: "Unsupported parameter: text.format",
        }),
      );
      const result = await pingModelProvider({
        modelProvider: row(),
        projectId: "project-1",
      });
      expect(refusedCode(result)).toBe("provider_refused");
    });
  });
});

describe("given the Codex provider, which has no listing endpoint", () => {
  describe("when the connection is tested", () => {
    /** @scenario "A subscription-billed provider with no listing endpoint is testable" */
    it("pings it through the AI gateway, the way Langy reaches it", async () => {
      const result = await pingModelProvider({
        modelProvider: row({
          provider: "openai_codex",
          customKeys: { CODEX_ACCESS_TOKEN: "token" },
        }),
        projectId: "project-1",
      });
      expect(result).toEqual({ outcome: "verified", valid: true });
      expect(codexHandleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          featureKey: CONNECTION_TEST_FEATURE_KEY,
        }),
      );
      expect(nlpgoHandleMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a row that cannot be pinged", () => {
  describe("when there is no project to run it in", () => {
    it("answers nothing, so the credential probe's verdict stands", async () => {
      expect(
        await pingModelProvider({ modelProvider: row(), projectId: undefined }),
      ).toBeNull();
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });

  describe("when the provider has no chat model anywhere", () => {
    /** @scenario "A provider with no chat model to name reports as unchecked" */
    it("answers nothing and sends no generation", async () => {
      expect(
        await pingModelProvider({
          modelProvider: row({
            provider: "custom",
            models: [],
            customModels: null,
          }),
          projectId: "project-1",
        }),
      ).toBeNull();
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });
});
