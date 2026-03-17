import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCurrentContext,
  runWithContext,
  updateCurrentContext,
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
    it("returns undefined when no context is set", () => {
      expect(getCurrentContext()).toBeUndefined();
    });

    it("returns context when inside runWithContext", () => {
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

  describe("runWithContext", () => {
    it("propagates context through async operations", async () => {
      const testCtx: RequestContext = { projectId: "async-project" };

      const result = await runWithContext(testCtx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getCurrentContext()?.projectId;
      });

      expect(result).toBe("async-project");
    });

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

  describe("updateCurrentContext", () => {
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

    it("does nothing when no context is set", () => {
      expect(() =>
        updateCurrentContext({ organizationId: "no-context" })
      ).not.toThrow();
    });
  });
});

describe("context/logging", () => {
  it("returns null values when no context and no OTel span", () => {
    const logCtx = getLogContext();

    expect(logCtx.traceId).toBeNull();
    expect(logCtx.spanId).toBeNull();
    expect(logCtx.organizationId).toBeNull();
    expect(logCtx.projectId).toBeNull();
    expect(logCtx.userId).toBeNull();
  });

  it("returns business context values when set", () => {
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
