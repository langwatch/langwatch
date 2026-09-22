/**
 * What a provider failure may put in the log: a rejected key makes the body the
 * credential, so every line goes through `providerErrorLogPayload`.
 * @see specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { TraceAiQueryService } from "../trace-ai-query.service.ts";

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
      const payload = TraceAiQueryService.providerErrorLogPayload({
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
      const payload = TraceAiQueryService.providerErrorLogPayload({
        projectId: "project-1",
        error: new RejectedKeyError(),
        model: "openai/gpt-5-mini",
      });

      expect(payload).not.toHaveProperty("attempt");
      expect(payload.providerError.httpStatus).toBe(401);
    });
  });
});
