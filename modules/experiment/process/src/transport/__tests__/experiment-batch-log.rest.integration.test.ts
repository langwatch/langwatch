/**
 * @vitest-environment node
 * What `POST /api/evaluations/batch/log_results` tells a caller when the write
 * fails. ADR-045 makes an unhandled cause generic.
 * @see modules/experiment/specs/experiment-batch-log.feature
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { EvaluationLogResultsTooLargeError } from "@langwatch/evaluation-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type * as observabilityModule from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";

import { experimentBatchLogRest } from "../experiment-batch-log.rest.ts";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

const DRIVER_MESSAGE =
  "Can't reach database server at `clickhouse.internal.langwatch:8443` (P1001)";

const PROJECT_ID = "project-1";

/** No route here is expected to throw, so a failure must be legible. */
function mount(
  logBatchEvaluation: ExperimentApi["logBatchEvaluation"],
  options: {
    assertBatchLogWithinLimit?: ExperimentApi["assertBatchLogWithinLimit"];
    /** What the family's boundary was handed, for a refusal the route does not write itself. */
    refused?: unknown[];
  } = {},
) {
  const assertBatchLogWithinLimit = options.assertBatchLogWithinLimit ?? (async () => undefined);
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });

  const app = runtime.mount(experimentBatchLogRest.router(), {
    app: () => createApiFixture<ExperimentApi>({ logBatchEvaluation, assertBatchLogWithinLimit }),
    onError: (error, context) => {
      options.refused?.push(error);
      if (HandledError.isHandled(error)) return canonicalErrorResponse(error, context);

      return context.json({ error: String(error) }, 500);
    },
  });

  return (body: unknown, sent: { contentType?: string; raw?: string } = {}) =>
    app.fetch(
      new Request("http://api.test/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": sent.contentType ?? "application/json" },
        body: sent.raw ?? JSON.stringify(body),
      }),
    );
}

describe("given the legacy evaluation batch log", () => {
  describe("when the body is larger than the organization accepts", () => {
    /** @scenario "A batch of results above the organization's limit is refused by name" */
    it("hands the boundary the batch log's own refusal before the body is parsed or written", async () => {
      const written = vi.fn(async () => undefined);
      const sizes: number[] = [];
      const refused: unknown[] = [];
      const raw = JSON.stringify({ experiment_slug: "my-experiment", run_id: "run-1" });
      const post = mount(written, {
        refused,
        assertBatchLogWithinLimit: async ({ payloadBytes }) => {
          sizes.push(payloadBytes);
          throw new EvaluationLogResultsTooLargeError({ maxBytes: 8 });
        },
      });

      await post(undefined, { raw });

      expect(refused).toEqual([
        expect.objectContaining({
          code: "evaluation_log_results_too_large",
          httpStatus: 413,
          meta: { maxBytes: 8 },
        }),
      ]);
      expect(sizes).toEqual([Buffer.byteLength(raw)]);
      expect(written).not.toHaveBeenCalled();
    });
  });

  describe("when the write fails with a driver diagnostic", () => {
    /** @scenario "A legacy evaluation batch failure returns no driver diagnostic" */
    it("answers a generic 500 rather than the store's own message", async () => {
      const post = mount(() => Promise.reject(new Error(DRIVER_MESSAGE)));

      const response = await post({
        experiment_slug: "my-experiment",
        run_id: "run-1",
        dataset: [],
        evaluations: [],
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("clickhouse.internal.langwatch");
      expect(body).toEqual({ error: "Internal server error" });
    });
  });

  describe("when the body is not a valid batch", () => {
    it("answers 400 and logs the refusal at warn, never error", async () => {
      loggerSpies.warn.mockClear();
      loggerSpies.error.mockClear();
      const post = mount(() => Promise.reject(new Error("the write must not be reached")));

      const response = await post({ run_id: 42 });

      expect(response.status).toBe(400);
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID }),
        "invalid log_results data received",
      );
      expect(loggerSpies.error).not.toHaveBeenCalled();
    });
  });

  describe("when the batch names neither an experiment id nor a slug", () => {
    it("refuses it before the write, in the sentence the SDK reads", async () => {
      const post = mount(() => Promise.reject(new Error("the write must not be reached")));

      const response = await post({ run_id: "run-1", dataset: [], evaluations: [] });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Either experiment_id or experiment_slug is required",
      });
    });
  });

  describe("when the batch is accepted", () => {
    it("answers the acknowledgement, and hands the write the caller's own project", async () => {
      const logged: unknown[] = [];
      const post = mount(async (input) => {
        logged.push(input);
      });

      const response = await post({
        experiment_slug: "my-experiment",
        run_id: "run-1",
        dataset: [],
        evaluations: [],
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "ok" });
      expect(logged).toHaveLength(1);
      expect((logged[0] as { projectId: string }).projectId).toBe(PROJECT_ID);
    });
  });

  describe("when the body is not sent as json", () => {
    it("answers the framework's 400 malformed_request", async () => {
      const post = mount(() => Promise.reject(new Error("the write must not be reached")));

      const response = await post(undefined, { contentType: "text/plain", raw: "{}" });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
    });
  });

  describe("when the body does not parse as json", () => {
    it("answers the framework's 400 malformed_request", async () => {
      const post = mount(() => Promise.reject(new Error("the write must not be reached")));

      const response = await post(undefined, { raw: "{not json" });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
    });
  });
});

describe("given the legacy evaluation batch log behind a door that refuses the caller", () => {
  it("leaves the refusal to the family's boundary, not main's 400 sentence", async () => {
    class DoorRefusedError extends HandledError {
      constructor() {
        super("unauthorized", "No credential", { httpStatus: 401 });
      }
    }
    const runtime = createRestRuntime({
      identity: {
        authenticate: () => {
          throw new DoorRefusedError();
        },
      },
    });
    const boundary = vi.fn((_error: Error, context: Context) =>
      context.json({ boundary: true }, 401),
    );
    const app = runtime.mount(experimentBatchLogRest.router(), {
      app: () => createApiFixture<ExperimentApi>({}),
      onError: boundary,
    });

    const response = await app.fetch(
      new Request("http://api.test/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ boundary: true });
    expect(boundary).toHaveBeenCalledWith(expect.any(DoorRefusedError), expect.anything());
  });
});
