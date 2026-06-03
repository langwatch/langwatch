import { describe, expect, it, vi } from "vitest";
import {
  getCurrentContext,
  type RequestContext,
} from "~/server/context/asyncContext";
import { withJobContext } from "../withJobContext";

vi.mock("@opentelemetry/api", () => ({
  context: { active: vi.fn(() => ({})) },
  trace: { getSpan: vi.fn(() => undefined) },
}));

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

    await withJobContext(processor)(mockJob);

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

    await withJobContext(processor)(mockJob);

    expect(capturedContext?.organizationId).toBe("org-legacy");
    expect(capturedContext?.projectId).toBe("proj-legacy");
    expect(capturedContext?.userId).toBe("user-legacy");

    expect(capturedData.traceId).toBe("legacy-trace-123");
    expect(capturedData.spans).toEqual([{ id: "legacy-span-1" }]);
    expect(capturedData.__payload).toBeUndefined();
  });

  it("handles legacy format without __context", async () => {
    const mockJob = {
      data: {
        __payload: { traceId: "legacy-no-ctx", spans: [] },
      },
    } as any;

    let capturedData: any;
    const processor = vi.fn(async (job: any) => {
      capturedData = job.data;
      return "result";
    });

    await withJobContext(processor)(mockJob);

    expect(capturedData.traceId).toBe("legacy-no-ctx");
    expect(capturedData.__payload).toBeUndefined();
  });
});
