/**
 * The engine's `NodeError.Type` becomes a handled code the client renders from
 * — never the raw message, which can name a URL or a Go net error.
 */
import { describe, expect, it } from "vitest";

import { nodeErrorToDomainError } from "../nodeErrorDomain";

describe("nodeErrorToDomainError", () => {
  describe("given a code the engine owns", () => {
    it("attributes an engine bug to the platform", () => {
      expect(nodeErrorToDomainError({ errorType: "engine_error" }).fault).toBe(
        "platform",
      );
    });

    it("attributes an unwired executor to the platform", () => {
      expect(
        nodeErrorToDomainError({ errorType: "llm_executor_unavailable" }).fault,
      ).toBe("platform");
    });
  });

  describe("given a code the customer owns", () => {
    it("attributes a failure in their own code node to them", () => {
      expect(
        nodeErrorToDomainError({ errorType: "code_runner_error" }).fault,
      ).toBe("customer");
    });

    it("attributes a bad dataset to them", () => {
      expect(
        nodeErrorToDomainError({ errorType: "invalid_dataset" }).fault,
      ).toBe("customer");
    });
  });

  describe("given a code a third party owns", () => {
    it("attributes an LLM call failure to the provider", () => {
      expect(nodeErrorToDomainError({ errorType: "llm_error" }).fault).toBe(
        "provider",
      );
    });
  });

  describe("given an unregistered code forwarded from the code runner", () => {
    /**
     * `engine.go` forwards `res.Error.Type` straight through, so a Python
     * exception class name arrives as the code. Blaming a provider for it
     * sends the customer looking at our integrations for their own bug.
     */
    it("does not blame a provider", () => {
      expect(
        nodeErrorToDomainError({ errorType: "ValueError" }).fault,
      ).not.toBe("provider");
    });
  });

  describe("given an upstream HTTP status", () => {
    it("attributes a 4xx to the caller", () => {
      expect(
        nodeErrorToDomainError({
          errorType: "upstream_http_error",
          upstreamStatus: 404,
        }).fault,
      ).toBe("customer");
    });

    it("attributes a 5xx to the upstream", () => {
      expect(
        nodeErrorToDomainError({
          errorType: "upstream_http_error",
          upstreamStatus: 503,
        }).fault,
      ).toBe("provider");
    });
  });

  it("carries the code, not the raw message", () => {
    const domain = nodeErrorToDomainError({
      errorType: "http_error",
      // The exact leak this exists to stop.
      message:
        'httpblock: Post "https://api.example.com/agent/chat": lookup api.example.com: no such host',
      traceId: "abc123",
    });

    expect(domain.code).toBe("http_error");
    // #5984: the serialised shape has no message field, so the raw string
    // cannot reach the client.
    expect(domain).not.toHaveProperty("message");
    expect(JSON.stringify(domain)).not.toContain("no such host");
    expect(domain.traceId).toBe("abc123");
  });

  it("puts the upstream status where the registry reads it", () => {
    const domain = nodeErrorToDomainError({
      errorType: "upstream_http_error",
      message: "httpblock: upstream returned 503",
      upstreamStatus: 503,
    });

    expect(domain.code).toBe("upstream_http_error");
    expect(domain.meta).toEqual({ upstreamStatus: 503 });
    expect(domain.httpStatus).toBe(503);
  });

  it("defaults the status when the failure was not an upstream response", () => {
    const domain = nodeErrorToDomainError({
      errorType: "http_error",
      message: "boom",
    });

    expect(domain.httpStatus).toBe(502);
    expect(domain.meta).toEqual({});
  });
});
