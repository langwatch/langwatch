import { describe, expect, it } from "vitest";

import { nodeErrorToDomainError } from "../src/workflow-node-error";

describe("nodeErrorToDomainError", () => {
  it.each([
    ["engine_error", "platform"],
    ["llm_executor_unavailable", "platform"],
    ["code_runner_error", "customer"],
    ["invalid_dataset", "customer"],
    ["llm_error", "provider"],
    ["ValueError", "platform"],
    ["attachment_fetch_error", "platform"],
  ])("classifies %s as %s", (errorType, fault) => {
    expect(nodeErrorToDomainError({ errorType }).fault).toBe(fault);
  });

  it("attributes a 4xx upstream response to the caller", () => {
    expect(
      nodeErrorToDomainError({
        errorType: "upstream_http_error",
        upstreamStatus: 404,
      }).fault,
    ).toBe("customer");
  });

  it("attributes a 5xx upstream response to the provider", () => {
    expect(
      nodeErrorToDomainError({
        errorType: "upstream_http_error",
        upstreamStatus: 503,
      }).fault,
    ).toBe("provider");
  });

  it("serializes the code and never the raw message", () => {
    const domain = nodeErrorToDomainError({
      errorType: "http_error",
      message:
        'httpblock: Post "https://api.example.com/agent/chat": lookup api.example.com: no such host',
      traceId: "abc123",
    });

    expect(domain.code).toBe("http_error");
    expect(domain).not.toHaveProperty("message");
    expect(JSON.stringify(domain)).not.toContain("no such host");
    expect(domain.traceId).toBe("abc123");
  });

  it("keeps upstream status in registry metadata and HTTP status", () => {
    const domain = nodeErrorToDomainError({
      errorType: "upstream_http_error",
      message: "httpblock: upstream returned 503",
      upstreamStatus: 503,
    });

    expect(domain.code).toBe("upstream_http_error");
    expect(domain.meta).toEqual({ upstreamStatus: 503 });
    expect(domain.httpStatus).toBe(503);
  });

  it("defaults non-upstream failures to a 502 status", () => {
    const domain = nodeErrorToDomainError({
      errorType: "http_error",
      message: "boom",
    });

    expect(domain.httpStatus).toBe(502);
    expect(domain.meta).toEqual({});
  });
});
