import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCurrentContext,
  runWithContext,
  createContextFromHono,
  createContextFromTRPC,
  createContextFromNextRequest,
  createContextFromNextApiRequest,
  createContextFromJobData,
  getLogContext,
  getJobContextMetadata,
  updateCurrentContext,
  type RequestContext,
} from "../asyncContext";

describe("asyncContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentContext", () => {
    it("returns undefined when no context is set", () => {
      const ctx = getCurrentContext();
      expect(ctx).toBeUndefined();
    });

    it("returns context when inside runWithContext", () => {
      const testCtx: RequestContext = {
        traceId: "test-trace-id",
        spanId: "test-span-id",
        organizationId: "org-123",
        projectId: "proj-456",
        userId: "user-789",
      };

      runWithContext(testCtx, () => {
        const ctx = getCurrentContext();
        expect(ctx).toEqual(testCtx);
      });
    });
  });

  describe("runWithContext", () => {
    it("makes context available within the function", () => {
      const testCtx: RequestContext = {
        traceId: "abc123",
        spanId: "def456",
      };

      const result = runWithContext(testCtx, () => {
        const ctx = getCurrentContext();
        return ctx?.traceId;
      });

      expect(result).toBe("abc123");
    });

    it("propagates context through async operations", async () => {
      const testCtx: RequestContext = {
        traceId: "async-trace",
        spanId: "async-span",
        projectId: "async-project",
      };

      const result = await runWithContext(testCtx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const ctx = getCurrentContext();
        return ctx?.projectId;
      });

      expect(result).toBe("async-project");
    });

    it("isolates context between nested calls", () => {
      const outerCtx: RequestContext = {
        traceId: "outer-trace",
        spanId: "outer-span",
      };
      const innerCtx: RequestContext = {
        traceId: "inner-trace",
        spanId: "inner-span",
      };

      runWithContext(outerCtx, () => {
        expect(getCurrentContext()?.traceId).toBe("outer-trace");

        runWithContext(innerCtx, () => {
          expect(getCurrentContext()?.traceId).toBe("inner-trace");
        });

        // Back to outer context
        expect(getCurrentContext()?.traceId).toBe("outer-trace");
      });
    });
  });

  describe("createContextFromHono", () => {
    it("extracts context from Hono context", () => {
      const mockHonoContext = {
        get: vi.fn((key: string) => {
          const store: Record<string, any> = {
            traceId: "hono-trace",
            spanId: "hono-span",
            organization: { id: "org-hono" },
            project: { id: "proj-hono" },
            user: { id: "user-hono" },
          };
          return store[key];
        }),
      } as any;

      const ctx = createContextFromHono(mockHonoContext);

      expect(ctx.traceId).toBe("hono-trace");
      expect(ctx.spanId).toBe("hono-span");
      expect(ctx.organizationId).toBe("org-hono");
      expect(ctx.projectId).toBe("proj-hono");
      expect(ctx.userId).toBe("user-hono");
    });

    it("generates trace/span IDs when not available", () => {
      const mockHonoContext = {
        get: vi.fn(() => undefined),
      } as any;

      const ctx = createContextFromHono(mockHonoContext);

      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("createContextFromTRPC", () => {
    it("extracts context from tRPC context and input", () => {
      const trpcCtx = {
        session: { user: { id: "trpc-user" } },
      };
      const input = {
        projectId: "trpc-project",
        organizationId: "trpc-org",
      };

      const ctx = createContextFromTRPC(trpcCtx, input);

      expect(ctx.userId).toBe("trpc-user");
      expect(ctx.projectId).toBe("trpc-project");
      expect(ctx.organizationId).toBe("trpc-org");
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("handles missing session", () => {
      const trpcCtx = { session: null };

      const ctx = createContextFromTRPC(trpcCtx);

      expect(ctx.userId).toBeUndefined();
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("createContextFromNextRequest", () => {
    it("generates IDs for Next.js App Router request", () => {
      const mockReq = {} as any;

      const ctx = createContextFromNextRequest(mockReq);

      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(ctx.organizationId).toBeUndefined();
      expect(ctx.projectId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("createContextFromNextApiRequest", () => {
    it("generates IDs for Next.js Pages Router request", () => {
      const mockReq = {} as any;

      const ctx = createContextFromNextApiRequest(mockReq);

      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("createContextFromJobData", () => {
    it("restores context from job metadata", () => {
      const jobMetadata = {
        traceId: "job-trace",
        parentSpanId: "job-parent-span",
        organizationId: "job-org",
        projectId: "job-proj",
        userId: "job-user",
      };

      const ctx = createContextFromJobData(jobMetadata);

      expect(ctx.traceId).toBe("job-trace");
      expect(ctx.organizationId).toBe("job-org");
      expect(ctx.projectId).toBe("job-proj");
      expect(ctx.userId).toBe("job-user");
      // spanId is generated fresh, not taken from parentSpanId
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("generates IDs when metadata is missing", () => {
      const ctx = createContextFromJobData(undefined);

      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("getLogContext", () => {
    it("returns null values when no context is set", () => {
      const logCtx = getLogContext();

      expect(logCtx).toEqual({
        traceId: null,
        spanId: null,
        organizationId: null,
        projectId: null,
        userId: null,
      });
    });

    it("returns context values when set", () => {
      const testCtx: RequestContext = {
        traceId: "log-trace",
        spanId: "log-span",
        organizationId: "log-org",
        projectId: "log-proj",
        userId: "log-user",
      };

      runWithContext(testCtx, () => {
        const logCtx = getLogContext();
        expect(logCtx).toEqual({
          traceId: "log-trace",
          spanId: "log-span",
          organizationId: "log-org",
          projectId: "log-proj",
          userId: "log-user",
        });
      });
    });
  });

  describe("getJobContextMetadata", () => {
    it("extracts metadata for job payloads", () => {
      const testCtx: RequestContext = {
        traceId: "meta-trace",
        spanId: "meta-span",
        organizationId: "meta-org",
        projectId: "meta-proj",
        userId: "meta-user",
      };

      runWithContext(testCtx, () => {
        const metadata = getJobContextMetadata();
        expect(metadata).toEqual({
          traceId: "meta-trace",
          parentSpanId: "meta-span",
          organizationId: "meta-org",
          projectId: "meta-proj",
          userId: "meta-user",
        });
      });
    });

    it("returns undefined values when no context", () => {
      const metadata = getJobContextMetadata();
      expect(metadata).toEqual({
        traceId: undefined,
        parentSpanId: undefined,
        organizationId: undefined,
        projectId: undefined,
        userId: undefined,
      });
    });
  });

  describe("updateCurrentContext", () => {
    it("updates mutable context fields", () => {
      const testCtx: RequestContext = {
        traceId: "update-trace",
        spanId: "update-span",
      };

      runWithContext(testCtx, () => {
        updateCurrentContext({
          organizationId: "updated-org",
          projectId: "updated-proj",
          userId: "updated-user",
        });

        const ctx = getCurrentContext();
        expect(ctx?.organizationId).toBe("updated-org");
        expect(ctx?.projectId).toBe("updated-proj");
        expect(ctx?.userId).toBe("updated-user");
        // Immutable fields unchanged
        expect(ctx?.traceId).toBe("update-trace");
        expect(ctx?.spanId).toBe("update-span");
      });
    });

    it("does nothing when no context is set", () => {
      // Should not throw
      expect(() =>
        updateCurrentContext({ organizationId: "no-context" })
      ).not.toThrow();
    });
  });
});
