import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordSpan = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      recordSpan: mockRecordSpan,
    },
  }),
}));

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/server/traces/trace.service", () => ({
  AmbiguousTraceIdPrefixError: class extends Error {},
  TraceService: { create: () => ({}) },
}));

vi.mock("~/server/traces/enrich-evaluations", () => ({
  enrichTracesWithEvaluations: vi.fn().mockReturnValue([]),
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockResolvedValue("formatted"),
}));

vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("tree"),
  formatTraceSummaryDigest: vi.fn().mockReturnValue("digest"),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/server/api/routers/traces.schemas", () => {
  const { z } = require("zod");
  return {
    getAllForProjectInput: z.object({
      projectId: z.string(),
      startDate: z.number(),
      endDate: z.number(),
      pageSize: z.number().optional(),
    }),
  };
});

const { app: v1App } = await import("../app.v1");

const testApp = new Hono();
testApp.use("*", async (c, next) => {
  c.set("project" as never, {
    id: "project-123",
    slug: "test-project",
    piiRedactionLevel: "DISABLED",
  });
  c.set("apiKeyUserId" as never, "user-456");
  await next();
});
testApp.route("/", v1App);

function patchMetadata(traceId: string, metadata: Record<string, unknown>) {
  return testApp.request(`/${traceId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata }),
  });
}

describe("PATCH /:traceId/metadata", () => {
  beforeEach(() => {
    mockRecordSpan.mockClear();
  });

  describe("when called with valid reserved metadata", () => {
    /** @scenario PATCH endpoint injects a synthetic span with metadata as resource attributes */
    it("calls recordSpan with resource containing reserved field attributes", async () => {
      const res = await patchMetadata("trace-abc", {
        user_id: "new-user",
        labels: ["qa"],
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.traceId).toBe("trace-abc");

      expect(mockRecordSpan).toHaveBeenCalledOnce();
      const call = mockRecordSpan.mock.calls[0]![0];

      expect(call.tenantId).toBe("project-123");
      expect(call.span.traceId).toBe("trace-abc");
      expect(call.span.name).toBe("langwatch.metadata_update");
      expect(call.instrumentationScope).toEqual({
        name: "langwatch.api.metadata_update",
      });

      const resourceAttrs = call.resource?.attributes ?? [];
      const attrMap = Object.fromEntries(
        resourceAttrs.map((a: { key: string; value: { stringValue?: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrMap["langwatch.user.id"]).toBe("new-user");
      expect(attrMap["langwatch.labels"]).toBe('["qa"]');
    });
  });

  describe("when called with an empty metadata object", () => {
    /** @scenario PATCH endpoint rejects empty metadata object */
    it("returns 400", async () => {
      const res = await patchMetadata("trace-abc", {});
      expect(res.status).toBe(400);
      expect(mockRecordSpan).not.toHaveBeenCalled();
    });
  });

  describe("when called with an oversized metadata value", () => {
    /** @scenario PATCH endpoint rejects oversized metadata values */
    it("returns 400 for values exceeding 4KB", async () => {
      const res = await patchMetadata("trace-abc", {
        big_value: "x".repeat(4097),
      });
      expect(res.status).toBe(400);
      expect(mockRecordSpan).not.toHaveBeenCalled();
    });
  });

  describe("when called with all reserved fields", () => {
    /** @scenario PATCH endpoint maps reserved fields to resource attributes */
    it("maps user_id, customer_id, thread_id to canonical resource attributes", async () => {
      const res = await patchMetadata("trace-abc", {
        user_id: "u1",
        customer_id: "c1",
        thread_id: "t1",
      });

      expect(res.status).toBe(200);

      const call = mockRecordSpan.mock.calls[0]![0];
      const resourceAttrs = call.resource?.attributes ?? [];
      const attrMap = Object.fromEntries(
        resourceAttrs.map((a: { key: string; value: { stringValue?: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrMap["langwatch.user.id"]).toBe("u1");
      expect(attrMap["langwatch.customer.id"]).toBe("c1");
      expect(attrMap["langwatch.thread.id"]).toBe("t1");
    });
  });

  describe("when called with custom metadata keys", () => {
    /** @scenario PATCH endpoint maps custom keys to langwatch.metadata.* resource attributes */
    it("prefixes custom keys with langwatch.metadata.", async () => {
      const res = await patchMetadata("trace-abc", {
        environment: "staging",
      });

      expect(res.status).toBe(200);

      const call = mockRecordSpan.mock.calls[0]![0];
      const resourceAttrs = call.resource?.attributes ?? [];
      const attrMap = Object.fromEntries(
        resourceAttrs.map((a: { key: string; value: { stringValue?: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrMap["langwatch.metadata.environment"]).toBe("staging");
    });
  });

  describe("when called with mixed reserved and custom fields", () => {
    it("splits into resource reserved and custom attributes", async () => {
      const res = await patchMetadata("trace-abc", {
        user_id: "u1",
        labels: ["qa"],
        custom_key: "val",
      });

      expect(res.status).toBe(200);

      const call = mockRecordSpan.mock.calls[0]![0];
      const resourceAttrs = call.resource?.attributes ?? [];
      const attrMap = Object.fromEntries(
        resourceAttrs.map((a: { key: string; value: { stringValue?: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrMap["langwatch.user.id"]).toBe("u1");
      expect(attrMap["langwatch.labels"]).toBe('["qa"]');
      expect(attrMap["langwatch.metadata.custom_key"]).toBe("val");
    });
  });

  describe("when checking API documentation", () => {
    /** @scenario API documentation includes the metadata update endpoint */
    it("has the update-metadata docs file", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const docsPath = path.resolve(
        __dirname,
        "../../../../../../..",
        "docs/api-reference/traces/update-metadata.mdx",
      );
      expect(fs.existsSync(docsPath)).toBe(true);

      const content = fs.readFileSync(docsPath, "utf-8");
      expect(content).toContain("Update trace metadata");
      expect(content).toContain("PATCH");
      expect(content).toContain("metadata");
    });
  });

  describe("when the span is created", () => {
    it("has zero duration and correct shape", async () => {
      await patchMetadata("trace-abc", { user_id: "u1" });

      const call = mockRecordSpan.mock.calls[0]![0];
      expect(call.span.startTimeUnixNano).toBe(call.span.endTimeUnixNano);
      expect(call.span.parentSpanId).toBeNull();
      expect(call.span.events).toEqual([]);
      expect(call.span.links).toEqual([]);
    });
  });
});
