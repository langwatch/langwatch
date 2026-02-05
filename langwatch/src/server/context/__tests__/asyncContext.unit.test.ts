import { describe, it, expect, vi, beforeEach } from "vitest";
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
  withJobContext,
  type RequestContext,
} from "../asyncContext";

// Mock OTel - trace/span comes from OTel, not our code
vi.mock("@opentelemetry/api", () => ({
  context: {
    active: vi.fn(() => ({})),
  },
  trace: {
    getSpan: vi.fn(() => undefined),
  },
}));

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
        projectId: "proj-123",
      };

      const result = runWithContext(testCtx, () => {
        const ctx = getCurrentContext();
        return ctx?.projectId;
      });

      expect(result).toBe("proj-123");
    });

    it("propagates context through async operations", async () => {
      const testCtx: RequestContext = {
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
        projectId: "outer-project",
      };
      const innerCtx: RequestContext = {
        projectId: "inner-project",
      };

      runWithContext(outerCtx, () => {
        expect(getCurrentContext()?.projectId).toBe("outer-project");

        runWithContext(innerCtx, () => {
          expect(getCurrentContext()?.projectId).toBe("inner-project");
        });

        // Back to outer context
        expect(getCurrentContext()?.projectId).toBe("outer-project");
      });
    });
  });

  describe("createContextFromHono", () => {
    it("extracts business context from Hono context", () => {
      const mockHonoContext = {
        get: vi.fn((key: string) => {
          const store: Record<string, any> = {
            organization: { id: "org-hono" },
            project: { id: "proj-hono" },
            user: { id: "user-hono" },
          };
          return store[key];
        }),
      } as any;

      const ctx = createContextFromHono(mockHonoContext);

      expect(ctx.organizationId).toBe("org-hono");
      expect(ctx.projectId).toBe("proj-hono");
      expect(ctx.userId).toBe("user-hono");
    });

    it("returns empty context when Hono context has no values", () => {
      const mockHonoContext = {
        get: vi.fn(() => undefined),
      } as any;

      const ctx = createContextFromHono(mockHonoContext);

      expect(ctx.organizationId).toBeUndefined();
      expect(ctx.projectId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
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
    });

    it("handles missing session", () => {
      const trpcCtx = { session: null };

      const ctx = createContextFromTRPC(trpcCtx);

      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("createContextFromNextRequest", () => {
    it("returns empty context for Next.js App Router request", () => {
      const mockReq = {} as any;

      const ctx = createContextFromNextRequest(mockReq);

      // Business context populated later by route handlers
      expect(ctx.organizationId).toBeUndefined();
      expect(ctx.projectId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("createContextFromNextApiRequest", () => {
    it("returns empty context for Next.js Pages Router request", () => {
      const mockReq = {} as any;

      const ctx = createContextFromNextApiRequest(mockReq);

      // Business context populated later by route handlers
      expect(ctx.organizationId).toBeUndefined();
      expect(ctx.projectId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("createContextFromJobData", () => {
    it("restores business context from job metadata", () => {
      const jobMetadata = {
        traceId: "job-trace",
        parentSpanId: "job-parent-span",
        organizationId: "job-org",
        projectId: "job-proj",
        userId: "job-user",
      };

      const ctx = createContextFromJobData(jobMetadata);

      // Business context restored from metadata
      expect(ctx.organizationId).toBe("job-org");
      expect(ctx.projectId).toBe("job-proj");
      expect(ctx.userId).toBe("job-user");
    });

    it("returns empty context when metadata is missing", () => {
      const ctx = createContextFromJobData(undefined);

      expect(ctx.organizationId).toBeUndefined();
      expect(ctx.projectId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("getLogContext", () => {
    it("returns null values when no context is set and no OTel span", () => {
      const logCtx = getLogContext();

      // trace/span come from OTel (mocked to return undefined)
      // business context comes from ALS (not set)
      expect(logCtx.traceId).toBeNull();
      expect(logCtx.spanId).toBeNull();
      expect(logCtx.organizationId).toBeNull();
      expect(logCtx.projectId).toBeNull();
      expect(logCtx.userId).toBeNull();
    });

    it("returns business context values when set", () => {
      const testCtx: RequestContext = {
        organizationId: "log-org",
        projectId: "log-proj",
        userId: "log-user",
      };

      runWithContext(testCtx, () => {
        const logCtx = getLogContext();
        // trace/span come from OTel (mocked to return null when no span)
        expect(logCtx.traceId).toBeNull();
        expect(logCtx.spanId).toBeNull();
        // business context comes from our ALS
        expect(logCtx.organizationId).toBe("log-org");
        expect(logCtx.projectId).toBe("log-proj");
        expect(logCtx.userId).toBe("log-user");
      });
    });
  });

  describe("getJobContextMetadata", () => {
    it("extracts business context for job payloads", () => {
      const testCtx: RequestContext = {
        organizationId: "meta-org",
        projectId: "meta-proj",
        userId: "meta-user",
      };

      runWithContext(testCtx, () => {
        const metadata = getJobContextMetadata();
        // trace/span come from OTel (mocked to return undefined)
        expect(metadata.traceId).toBeUndefined();
        expect(metadata.parentSpanId).toBeUndefined();
        // business context comes from our ALS
        expect(metadata.organizationId).toBe("meta-org");
        expect(metadata.projectId).toBe("meta-proj");
        expect(metadata.userId).toBe("meta-user");
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
      const testCtx: RequestContext = {};

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
      });
    });

    it("does nothing when no context is set", () => {
      // Should not throw
      expect(() =>
        updateCurrentContext({ organizationId: "no-context" })
      ).not.toThrow();
    });
  });

  describe("withJobContext", () => {
    it("processes new format jobs with __context at root level", async () => {
      const mockJob = {
        data: {
          traceId: "trace-123",
          spans: [{ id: "span-1" }],
          __context: {
            organizationId: "org-new",
            projectId: "proj-new",
            userId: "user-new",
          },
        },
      } as any;

      let capturedContext: RequestContext | undefined;
      let capturedData: any;

      const processor = vi.fn(async (job: any) => {
        capturedContext = getCurrentContext();
        capturedData = job.data;
        return "result";
      });

      const wrappedProcessor = withJobContext(processor);
      await wrappedProcessor(mockJob);

      expect(capturedContext?.organizationId).toBe("org-new");
      expect(capturedContext?.projectId).toBe("proj-new");
      expect(capturedContext?.userId).toBe("user-new");
      expect(capturedData.traceId).toBe("trace-123");
      expect(capturedData.spans).toEqual([{ id: "span-1" }]);
    });

    it("migrates legacy format jobs with __payload wrapper", async () => {
      const mockJob = {
        data: {
          __payload: {
            traceId: "legacy-trace-123",
            spans: [{ id: "legacy-span-1" }],
          },
          __context: {
            organizationId: "org-legacy",
            projectId: "proj-legacy",
            userId: "user-legacy",
          },
        },
      } as any;

      let capturedContext: RequestContext | undefined;
      let capturedData: any;

      const processor = vi.fn(async (job: any) => {
        capturedContext = getCurrentContext();
        capturedData = job.data;
        return "result";
      });

      const wrappedProcessor = withJobContext(processor);
      await wrappedProcessor(mockJob);

      // Context should be restored from __context
      expect(capturedContext?.organizationId).toBe("org-legacy");
      expect(capturedContext?.projectId).toBe("proj-legacy");
      expect(capturedContext?.userId).toBe("user-legacy");

      // Data should be unwrapped from __payload
      expect(capturedData.traceId).toBe("legacy-trace-123");
      expect(capturedData.spans).toEqual([{ id: "legacy-span-1" }]);
      expect(capturedData.__payload).toBeUndefined();
    });

    it("handles legacy format without __context", async () => {
      const mockJob = {
        data: {
          __payload: {
            traceId: "legacy-no-ctx",
            spans: [],
          },
        },
      } as any;

      let capturedData: any;

      const processor = vi.fn(async (job: any) => {
        capturedData = job.data;
        return "result";
      });

      const wrappedProcessor = withJobContext(processor);
      await wrappedProcessor(mockJob);

      // Data should be unwrapped from __payload
      expect(capturedData.traceId).toBe("legacy-no-ctx");
      expect(capturedData.__payload).toBeUndefined();
    });
  });
});
