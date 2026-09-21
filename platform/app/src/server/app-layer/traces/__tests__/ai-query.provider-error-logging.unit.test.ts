/**
 * @vitest-environment node
 *
 * What a provider failure is allowed to put in the log.
 *
 * `summarizeProviderError` exists because a rejected key makes the provider's
 * own response body the credential (see
 * `ai-query.summarize-provider-error.unit.test.ts`). The disclosure the
 * customer reads has gone through it since #5984; the log lines had not, and
 * they were handing `logger.error` the raw exception. Every provider path now
 * builds its payload through `providerErrorLogPayload`, which is what this
 * reads.
 *
 * Deliberately mock-free. The unit lane runs `isolate: false`, so a module
 * mock registered here would apply to every other file sharing the worker;
 * a payload builder can be called directly instead.
 *
 * Spec: specs/traces-v2/search.feature ("A provider failure is logged
 * curated, never raw").
 */
import { describe, expect, it } from "vitest";
import { providerErrorLogPayload } from "../ai-query";

const CREDENTIAL = "sk-proj-abcdefghijklmnop";

class RejectedKeyError extends Error {
  statusCode = 401;
  responseBody = `{"message":"Incorrect API key provided: ${CREDENTIAL}"}`;
  constructor() {
    super(
      `litellm.AuthenticationError: OpenAIException - Incorrect API key provided: ${CREDENTIAL}`,
    );
  }
}

describe("given a provider failure carrying a credential", () => {
  describe("when the log payload is built", () => {
    /** @scenario "A provider failure is logged curated, never raw" */
    it("carries the provider, the model and the status code, and none of the provider's own text", () => {
      const payload = providerErrorLogPayload({
        projectId: "project-1",
        attempt: 2,
        error: new RejectedKeyError(),
        model: "openai/gpt-5-mini",
      });

      expect(payload).toEqual({
        projectId: "project-1",
        attempt: 2,
        providerError: {
          httpStatus: 401,
          provider: "openai",
          model: "openai/gpt-5-mini",
        },
      });
      expect(JSON.stringify(payload)).not.toContain(CREDENTIAL);
    });

    /** @scenario "A provider failure is logged curated, never raw" */
    it("leaves the attempt out where a path has no attempts to count", () => {
      const payload = providerErrorLogPayload({
        projectId: "project-1",
        error: new RejectedKeyError(),
        model: "openai/gpt-5-mini",
      });

      expect(payload).not.toHaveProperty("attempt");
      expect(payload.providerError.httpStatus).toBe(401);
    });
  });
});
