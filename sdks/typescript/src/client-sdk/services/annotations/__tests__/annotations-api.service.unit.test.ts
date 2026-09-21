import { describe, expect, it, vi } from "vitest";
import {
  AnnotationsApiService,
  type AnnotationResponse,
  type CreateAnnotationBody,
} from "../annotations-api.service";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * The server wraps every annotation read and write in `{ data: ... }`
 * (`platform/app/src/server/routes/annotations.ts` — trace GET :299,
 * list GET :140, single GET :173, POST :378, PATCH :263), and has done so
 * since before the Hono migration. The published SDK returned that envelope
 * unwrapped, so `getByTrace(...).filter(...)` crashed with
 * "res.filter is not a function" (issue #7863).
 */
const annotation: AnnotationResponse = {
  id: "annotation_1",
  projectId: "project_1",
  traceId: "trace_1",
  comment: "helpful answer",
  isThumbsUp: true,
  // Nullable columns in `model Annotation` — the row always carries the key,
  // with JSON null when unset, which is why they are required-and-nullable
  // rather than optional.
  userId: null,
  email: "reviewer@example.com",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const clientWith = (body: unknown): LangwatchApiClient => {
  const result = {
    data: body,
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
  return {
    GET: vi.fn(async () => result),
    POST: vi.fn(async () => result),
    PATCH: vi.fn(async () => result),
    PUT: vi.fn(async () => result),
    DELETE: vi.fn(async () => result),
  } as unknown as LangwatchApiClient;
};

const serviceWith = (body: unknown) =>
  new AnnotationsApiService({ langwatchApiClient: clientWith(body) });

describe("given an AnnotationsApiService against the server's envelope", () => {
  describe("when getByTrace() answers `{ data: [...] }`", () => {
    it("returns the array itself, so callers can .filter it", async () => {
      const service = serviceWith({ data: [annotation] });

      const result = await service.getByTrace("trace_1");

      expect(Array.isArray(result)).toBe(true);
      expect(result.filter((a) => a.isThumbsUp)).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "annotation_1" });
    });
  });

  describe("when getAll() answers `{ data: [...] }`", () => {
    it("returns the array itself", async () => {
      const service = serviceWith({ data: [annotation] });

      const result = await service.getAll();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });
  });

  describe("when get() answers `{ data: {...} }`", () => {
    it("returns the annotation itself", async () => {
      const service = serviceWith({ data: annotation });

      const result = await service.get("annotation_1");

      expect(result.id).toBe("annotation_1");
      expect(result.comment).toBe("helpful answer");
    });
  });

  describe("when create() answers `{ data: {...} }`", () => {
    it("returns the created annotation itself", async () => {
      const service = serviceWith({ data: annotation });

      const result = await service.create("trace_1", {
        comment: "helpful answer",
        isThumbsUp: true,
      });

      expect(result.id).toBe("annotation_1");
    });
  });

  describe("when a caller builds the create body", () => {
    it("requires comment and isThumbsUp, as the server enforces at runtime", () => {
      // The server 400s without them (routes/annotations.ts:336-355), so the
      // generated type must refuse the same bodies at compile time.
      // @ts-expect-error — comment is required
      const missingComment: CreateAnnotationBody = { isThumbsUp: true };
      // @ts-expect-error — isThumbsUp is required
      const missingThumb: CreateAnnotationBody = { comment: "hi" };
      const complete: CreateAnnotationBody = {
        comment: "hi",
        isThumbsUp: true,
      };
      expect([missingComment, missingThumb, complete]).toBeDefined();
    });
  });
});
