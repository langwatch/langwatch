/**
 * An annotation made over REST has to reach the trace the same way one made in
 * the app does. `has:annotation` reads the trace summary's annotation ids, and
 * only the trace pipeline's add/remove commands write them: an annotation that
 * lands in Postgres alone exists in the list endpoints and is invisible to
 * search.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AuthMiddleware from "~/server/api-key/auth-middleware";

const mockAnnotationCreate = vi.fn();
const mockAnnotationDelete = vi.fn();
const mockAddAnnotation = vi.fn();
const mockRemoveAnnotation = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    annotation: {
      create: mockAnnotationCreate,
      delete: mockAnnotationDelete,
    },
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: vi.fn(() => ({
    traces: {
      addAnnotation: mockAddAnnotation,
      removeAnnotation: mockRemoveAnnotation,
    },
  })),
}));

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({
      resolve: vi.fn().mockResolvedValue({
        type: "legacyProjectKey",
        project: { id: "project-123" },
      }),
      markUsed: vi.fn(),
    })),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthMiddleware>();
  return {
    ...actual,
    extractCredentials: vi.fn(() => ({ token: "test-token" })),
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { app } = await import("../annotations");

describe("Annotations REST API → trace sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when an annotation is created on a trace", () => {
    beforeEach(() => {
      mockAnnotationCreate.mockImplementation(({ data }) =>
        Promise.resolve(data),
      );
    });

    it("records it on the trace, so has:annotation finds the trace", async () => {
      const res = await app.request("/api/annotations/trace/trace-abc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "looks wrong", isThumbsUp: false }),
      });

      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(mockAddAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-123",
          traceId: "trace-abc",
          annotationId: data.id,
        }),
      );
    });

    it("still answers 200 when the trace sync fails, since Postgres holds the annotation", async () => {
      mockAddAnnotation.mockRejectedValueOnce(new Error("queue down"));

      const res = await app.request("/api/annotations/trace/trace-abc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "looks wrong", isThumbsUp: false }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe("when an annotation is deleted", () => {
    beforeEach(() => {
      mockAnnotationDelete.mockResolvedValue({
        id: "ann-1",
        traceId: "trace-abc",
        projectId: "project-123",
      });
    });

    it("removes it from the trace, so has:annotation stops finding the trace", async () => {
      const res = await app.request("/api/annotations/ann-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(mockRemoveAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-123",
          traceId: "trace-abc",
          annotationId: "ann-1",
        }),
      );
    });
  });
});
