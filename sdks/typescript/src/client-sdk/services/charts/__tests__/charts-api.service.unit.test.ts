import { describe, expect, it, vi, beforeEach } from "vitest";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * The delegated query door has no path/body slot for project id (see
 * `QueryApiService`'s doc comment), so a `projectId` config can only reach
 * it through which client the door is built with. Proving that means
 * catching the client-construction call itself — `clientWith` below fakes
 * the transport, but that alone can't see which project a freshly-built
 * client was scoped to.
 */
const createLangWatchApiClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/internal/api/client", () => ({
  createLangWatchApiClient: createLangWatchApiClientMock,
}));

import { ChartsApiError, ChartsApiService } from "../charts-api.service";

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

  describe("when the delegated query door resolves its client", () => {
    beforeEach(() => {
      createLangWatchApiClientMock.mockReset();
    });

    /**
     * Regression coverage for the bug CodeRabbit flagged on
     * `PRRT_kwDOKRXhvM6c3Oui`: `new ChartsApiService({ projectId: "A" })`
     * did chart CRUD against project A, but its delegated `schema()` /
     * `runQuery()` rode the api client's ambient project scope instead —
     * which could be a different project, or none.
     */
    it("scopes the delegated query client to the configured projectId, not ambient scope", () => {
      const schemaResult = { database: "analytics", datasets: [] };
      createLangWatchApiClientMock.mockReturnValue(
        clientWith({
          data: schemaResult,
          response: new Response(null, { status: 200 }),
        }),
      );

      // No `langwatchApiClient` override — this is the real-world shape the
      // bug hit: only `projectId` configured, so the family must build the
      // query delegate's client itself rather than share `this.apiClient`
      // (which never learned `configuredProjectId`, only ambient scope).
      new ChartsApiService({ projectId: "configured-project" });

      expect(createLangWatchApiClientMock).toHaveBeenCalledWith(
        undefined,
        undefined,
        "configured-project",
      );
    });

    it("reuses the caller-supplied client verbatim for the query delegate", async () => {
      const schemaResult = { database: "analytics", datasets: [] };
      const suppliedClient = clientWith({
        data: schemaResult,
        response: new Response(null, { status: 200 }),
      });

      const service = new ChartsApiService({
        langwatchApiClient: suppliedClient,
        projectId: "configured-project",
      });
      const result = await service.schema();

      // The caller's own client is what runs the delegated call — the
      // factory is never asked to build a second, freshly-scoped one.
      expect(createLangWatchApiClientMock).not.toHaveBeenCalled();
      expect(suppliedClient.GET).toHaveBeenCalledWith("/api/v1/query/schema", {});
      expect(result).toEqual(schemaResult);
    });
  });
});
