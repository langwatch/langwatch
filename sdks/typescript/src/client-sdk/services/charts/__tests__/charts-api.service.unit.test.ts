import { describe, expect, it, vi } from "vitest";
import {
  ChartsApiError,
  ChartsApiService,
} from "../charts-api.service";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * The canonical REST envelope the analytics-sql chart family answers refusals
 * with (`app/api/shared/schemas.ts`): the whole failure nested under `error`.
 */
const notFoundBody = {
  error: {
    type: "not_found",
    code: "saved_workbench_chart_not_found",
    message: "Saved chart not found.",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  },
};

const clientWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): LangwatchApiClient =>
  ({
    GET: vi.fn(async () => result),
    POST: vi.fn(async () => result),
    PATCH: vi.fn(async () => result),
    PUT: vi.fn(async () => result),
    DELETE: vi.fn(async () => result),
  }) as unknown as LangwatchApiClient;

const serviceWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): ChartsApiService =>
  new ChartsApiService({
    langwatchApiClient: clientWith(result),
    projectId: "project-1",
  });

describe("ChartsApiService", () => {
  describe("when the platform names the failure in the canonical envelope", () => {
    it("raises the typed handled error with the platform's own code, status and message", async () => {
      const service = serviceWith({
        error: notFoundBody,
        response: new Response(null, { status: 404 }),
      });

      const thrown = await service.get("chart-1").then(
        () => {
          throw new Error("expected get to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "saved_workbench_chart_not_found",
        httpStatus: 404,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
      expect((thrown as Error).message).toContain("Saved chart not found.");
    });
  });

  describe("when the failure body is not the platform's shape", () => {
    it("throws the family's own error, status attached, exactly as before", async () => {
      const service = serviceWith({
        error: "<html>bad gateway</html>",
        response: new Response(null, { status: 502 }),
      });

      const thrown = await service.get("chart-1").then(
        () => {
          throw new Error("expected get to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(false);
      expect(thrown).toBeInstanceOf(ChartsApiError);
      expect((thrown as ChartsApiError).status).toBe(502);
    });
  });

  describe("when delete answers 204 with no body", () => {
    it("resolves without reading a body", async () => {
      const service = serviceWith({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 204 }),
      });

      await expect(service.delete("chart-1")).resolves.toBeUndefined();
    });
  });
});
