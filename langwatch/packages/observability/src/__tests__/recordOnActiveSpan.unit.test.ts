import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordOnActiveSpan } from "../trace/traceContext";

/**
 * `specs/observability/attributable-failures.feature`.
 *
 * The helper exists because the prod log pipeline keeps a record's message and
 * drops its structured fields, so identifiers passed to the logger do not reach
 * the log store. What matters here is that it records what it is given, skips
 * what it is not, and never becomes a reason a request fails.
 */
describe("recordOnActiveSpan", () => {
  const setAttribute = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    setAttribute.mockClear();
  });

  describe("when a span is active", () => {
    beforeEach(() => {
      vi.spyOn(trace, "getActiveSpan").mockReturnValue({
        setAttribute,
      } as never);
    });

    it("records each identifier it is given", () => {
      recordOnActiveSpan({
        "langwatch.project.id": "project-1",
        "auth.denied_permission": "traces:create",
        "http.response.status_code": 403,
        "auth.failed": true,
      });

      expect(setAttribute).toHaveBeenCalledWith(
        "langwatch.project.id",
        "project-1",
      );
      expect(setAttribute).toHaveBeenCalledWith(
        "auth.denied_permission",
        "traces:create",
      );
      expect(setAttribute).toHaveBeenCalledWith(
        "http.response.status_code",
        403,
      );
      expect(setAttribute).toHaveBeenCalledWith("auth.failed", true);
    });

    it("omits context that is unavailable rather than recording it empty", () => {
      recordOnActiveSpan({
        "langwatch.project.id": "project-1",
        "user_agent.original": undefined,
        "client.address": null,
      });

      expect(setAttribute).toHaveBeenCalledTimes(1);
      expect(setAttribute).toHaveBeenCalledWith(
        "langwatch.project.id",
        "project-1",
      );
    });

    it("records a false flag, which is a real answer and not absence", () => {
      recordOnActiveSpan({ "auth.has_empty_token": false });

      expect(setAttribute).toHaveBeenCalledWith("auth.has_empty_token", false);
    });
  });

  describe("when nothing is being traced", () => {
    it("records nothing and does not throw", () => {
      vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);

      expect(() =>
        recordOnActiveSpan({ "langwatch.project.id": "project-1" }),
      ).not.toThrow();
      expect(setAttribute).not.toHaveBeenCalled();
    });
  });
});
