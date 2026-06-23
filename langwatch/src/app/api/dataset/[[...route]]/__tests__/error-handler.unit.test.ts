import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { DatasetNotReadyError } from "../../../../../server/datasets/errors";
import { handleDatasetError } from "../error-handler";

/**
 * A minimal fake Hono Context: handleDatasetError only reads path/method/param
 * for logging and calls `c.json(body, status)`. We capture the status + parsed
 * body the handler chose so we can assert the domain→HTTP mapping directly,
 * without spinning up the whole route app.
 */
const fakeContext = (): {
  c: Context;
  captured: { status?: number; body?: unknown };
} => {
  const captured: { status?: number; body?: unknown } = {};
  const c = {
    req: { path: "/api/dataset/x/upload", method: "POST", param: () => ({}) },
    json: (body: unknown, status?: number) => {
      captured.body = body;
      captured.status = status;
      return new Response(JSON.stringify(body), { status });
    },
  } as unknown as Context;
  return { c, captured };
};

describe("handleDatasetError", () => {
  describe("when a DatasetNotReadyError propagates (e.g. POST /upload racing a normalize)", () => {
    it("maps to 425 Too Early, not 500", async () => {
      const { c, captured } = fakeContext();

      await handleDatasetError(
        new DatasetNotReadyError({ status: "processing" }),
        c,
      );

      // Regression: without the DOMAIN_ERROR_HTTP entry this fell through to
      // 500, paging on-call for a normal user-induced race.
      expect(captured.status).toBe(425);
      expect(captured.body).toMatchObject({ error: "DatasetNotReady" });
    });
  });
});
