/**
 * The engine's `NodeError.Type` becomes a handled code the client renders from
 * — never the raw message, which can name a URL or a Go net error.
 */
import { describe, expect, it } from "vitest";

import { nodeErrorToDomainError } from "../nodeErrorDomain";

describe("nodeErrorToDomainError", () => {
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
