import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCurrentContext,
  runWithContext,
  updateCurrentContext,
  getOtelSpanContext,
  type RequestContext,
} from "../context/core";
import { getLogContext } from "../context/logging";

vi.mock("@opentelemetry/api", () => ({
  context: {
    active: vi.fn(() => ({})),
  },
  trace: {
    getSpan: vi.fn(() => undefined),
  },
}));

describe("context/core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentContext", () => {
    describe("when no context is set", () => {
      it("returns undefined", () => {
        expect(getCurrentContext()).toBeUndefined();
      });
    });

    describe("when inside runWithContext", () => {
      it("returns the active context", () => {
        const testCtx: RequestContext = {
          organizationId: "org-123",
          projectId: "proj-456",
          userId: "user-789",
        };

        runWithContext(testCtx, () => {
          expect(getCurrentContext()).toEqual(testCtx);
        });
      });
    });
  });

  describe("runWithContext", () => {
    describe("when running async operations", () => {
      it("propagates context through async boundaries", async () => {
        const testCtx: RequestContext = { projectId: "async-project" };

        const result = await runWithContext(testCtx, async () => {
          await Promise.resolve();
          return getCurrentContext()?.projectId;
        });

        expect(result).toBe("async-project");
      });
    });

    describe("when nesting calls", () => {
      it("isolates context between nested calls", () => {
        runWithContext({ projectId: "outer" }, () => {
          expect(getCurrentContext()?.projectId).toBe("outer");

          runWithContext({ projectId: "inner" }, () => {
            expect(getCurrentContext()?.projectId).toBe("inner");
          });

          expect(getCurrentContext()?.projectId).toBe("outer");
        });
      });
    });
  });

  describe("updateCurrentContext", () => {
    describe("when context is active", () => {
      it("updates mutable context fields", () => {
        runWithContext({}, () => {
          updateCurrentContext({
            organizationId: "updated-org",
            projectId: "updated-proj",
            userId: "updated-user",
          });

          const ctx = getCurrentContext();
          expect(ctx?.organizationId).toBe("updated-org");
          expect(ctx?.projectId).toBe("updated-proj");
          expect(ctx?.userId).toBe("updated-user");
        });
      });
    });

    describe("when no context is set", () => {
      it("does not throw", () => {
        expect(() =>
          updateCurrentContext({ organizationId: "no-context" })
        ).not.toThrow();
      });
    });
  });

  describe("getOtelSpanContext", () => {
    describe("when no active span exists", () => {
      it("returns undefined", () => {
        expect(getOtelSpanContext()).toBeUndefined();
      });
    });

    describe("when an active span exists", () => {
      it("returns traceId and spanId", async () => {
        const { trace } = await import("@opentelemetry/api");
        vi.mocked(trace.getSpan).mockReturnValueOnce({
          spanContext: () => ({
            traceId: "abc123",
            spanId: "def456",
            traceFlags: 1,
          }),
        } as any);

        const result = getOtelSpanContext();
        expect(result).toEqual({ traceId: "abc123", spanId: "def456" });
      });
    });
  });
});

describe("context/logging", () => {
  describe("when no context and no OTel span exist", () => {
    it("returns null values for all fields", () => {
      const logCtx = getLogContext();

      expect(logCtx.traceId).toBeNull();
      expect(logCtx.spanId).toBeNull();
      expect(logCtx.organizationId).toBeNull();
      expect(logCtx.projectId).toBeNull();
      expect(logCtx.userId).toBeNull();
    });
  });

  describe("when business context is set", () => {
    it("returns the context values", () => {
      runWithContext(
        { organizationId: "log-org", projectId: "log-proj", userId: "log-user" },
        () => {
          const logCtx = getLogContext();
          expect(logCtx.organizationId).toBe("log-org");
          expect(logCtx.projectId).toBe("log-proj");
          expect(logCtx.userId).toBe("log-user");
        },
      );
    });
  });
});
