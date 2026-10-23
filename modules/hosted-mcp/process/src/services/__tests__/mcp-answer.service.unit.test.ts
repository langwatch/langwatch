/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import { HandledError } from "@langwatch/handled-error";
import type { McpDoorRequest } from "@langwatch/hosted-mcp-contract";
import { describe, expect, it } from "vitest";

import { McpAnswerService } from "../mcp-answer.service.ts";

const BASE_HOST = "https://app.langwatch.ai";

/** A handled refusal that asks the caller to wait, the shape a rate limiter throws. */
class RateLimitedError extends HandledError {
  constructor() {
    super("rate_limited", "Too many requests", {
      httpStatus: 429,
      meta: { retryAfterMs: 1500 },
    });
  }
}

function requestWithBody(read: Awaited<ReturnType<McpDoorRequest["readBody"]>>): McpDoorRequest {
  return {
    method: "POST",
    url: "/oauth/register",
    headers: { "content-type": "text/plain" },
    clientAddress: "127.0.0.1",
    readBody: () => Promise.resolve(read),
  };
}

describe("McpAnswerService", () => {
  const answers = McpAnswerService.create({ baseHost: BASE_HOST });

  describe("when a refusal carries a retry delay", () => {
    /** @scenario "A rate-limited refusal says when to retry" */
    it("answers with Retry-After beside the CORS headers", () => {
      const answer = answers.refusal(new RateLimitedError());

      expect(answer).toMatchObject({
        kind: "json",
        status: 429,
        headers: { "Access-Control-Allow-Origin": "*", "Retry-After": "2" },
        body: { error: "Too many requests" },
      });
    });
  });

  describe("when the failure is not a handled one", () => {
    it("answers 500 without naming the cause", () => {
      expect(answers.refusal(new Error("redis exploded"))).toMatchObject({
        status: 500,
        body: { error: "Internal server error" },
      });
    });
  });

  describe("when the body passed the size cap", () => {
    /** @scenario "A body past the cap is refused before it is parsed" */
    it("answers the 413 instead of a body", async () => {
      const read = await answers.readJsonBody(requestWithBody({ kind: "too-large" }));

      expect(read).toMatchObject({
        kind: "answered",
        answer: { status: 413, body: { error: "Request body too large" } },
      });
    });
  });

  describe("when the body is not JSON", () => {
    it("answers the 400 malformed request", async () => {
      const read = await answers.readJsonBody(requestWithBody({ kind: "read", body: "{nope" }));

      expect(read).toMatchObject({
        kind: "answered",
        answer: { status: 400, body: { error: "Invalid JSON body" } },
      });
    });
  });

  describe("when OAuth throttles a caller", () => {
    it("answers RFC 6749's shape with a 60 second Retry-After", () => {
      expect(answers.rateLimited()).toEqual({
        kind: "json",
        status: 429,
        headers: expect.objectContaining({ "Retry-After": "60" }),
        body: {
          error: "temporarily_unavailable",
          error_description: "Rate limit exceeded, retry later",
        },
      });
    });
  });
});
