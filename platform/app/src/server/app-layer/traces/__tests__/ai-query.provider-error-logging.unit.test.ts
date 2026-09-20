/**
 * @vitest-environment node
 *
 * What reaches the log when a provider call fails.
 *
 * `summarizeProviderError` exists because a rejected key makes the provider's
 * own response body the credential (see
 * `ai-query.summarize-provider-error.unit.test.ts`). The disclosure the
 * customer sees has gone through it since #5984; the log lines had not, and
 * they were sending the raw exception. This runs the failing call and reads
 * the payload the logger was handed.
 *
 * Spec: specs/traces-v2/search.feature ("A provider failure is logged
 * curated, never raw").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: { error: unknown[]; info: unknown[]; warn: unknown[] } = {
  error: [],
  info: [],
  warn: [],
};

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: (payload: unknown) => logged.error.push(payload),
    info: (payload: unknown) => logged.info.push(payload),
    warn: (payload: unknown) => logged.warn.push(payload),
    debug: () => undefined,
  }),
}));

const CREDENTIAL = "sk-proj-abcdefghijklmnop";

vi.mock("ai", () => ({
  generateObject: () => {
    const error = Object.assign(
      new Error(
        `litellm.AuthenticationError: OpenAIException - Incorrect API key provided: ${CREDENTIAL}`,
      ),
      { statusCode: 401, responseBody: `{"message":"key ${CREDENTIAL}"}` },
    );
    return Promise.reject(error);
  },
  generateText: () => Promise.reject(new Error("unused")),
}));

vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: () =>
    Promise.resolve({ modelId: "openai/gpt-5-mini" } as never),
}));

vi.mock("../query-language/fieldCatalogue", () => ({
  buildFieldsBlock: () => Promise.resolve("status, model"),
}));

const { generateInstantEvalQuestion } = await import("../ai-query");

describe("given a provider failure carrying a credential", () => {
  beforeEach(() => {
    logged.error.length = 0;
  });

  describe("when the Instant Eval question is written", () => {
    /** @scenario "A provider failure is logged curated, never raw" */
    it("logs the curated summary and none of the provider's own text", async () => {
      await expect(
        generateInstantEvalQuestion({
          projectId: "project-1",
          text: "annoyed users",
          target: "traces",
          known: { evaluators: [], events: [] },
        }),
      ).rejects.toThrow();

      expect(logged.error).toHaveLength(1);
      const payload = logged.error[0] as Record<string, unknown>;
      expect(payload.providerError).toEqual({
        httpStatus: 401,
        provider: "openai",
        model: "openai/gpt-5-mini",
      });
      expect(JSON.stringify(payload)).not.toContain(CREDENTIAL);
      expect(payload).not.toHaveProperty("err");
    });
  });
});
