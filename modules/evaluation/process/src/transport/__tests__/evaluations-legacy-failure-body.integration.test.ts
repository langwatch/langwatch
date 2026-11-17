/**
 * @vitest-environment node
 * What the evaluate doors tell a caller whose body is not JSON, or not an evaluation.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import type * as observabilityModule from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { evaluationsLegacyRest } from "../evaluations-legacy.rest.ts";

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

const PROJECT_ID = "project-1";

describe("given an evaluate door", () => {
  describe("when the body is not sent as json", () => {
    it.each([
      "/api/evaluations/basic/evaluate",
      "/api/evaluations/langevals/valid_format/evaluate",
      "/api/guardrails/basic/evaluate",
    ])("answers %s with the framework's 400 malformed_request before the handler", async (path) => {
      const runtime = createRestRuntime({
        authorization: restTestAuthorization(),
        identity: {
          authenticate: () => ({
            actor: { type: "user", id: "user-1" },
            scope: { tier: "project", id: PROJECT_ID },
          }),
        },
      });
      const app = runtime.mount(evaluationsLegacyRest.router(), {
        // "{}" parses, so a handler reached here would call the empty fixture and 500.
        app: () => createApiFixture<EvaluationApi>({}),
        onError: (error, context) =>
          HandledError.isHandled(error)
            ? canonicalErrorResponse(error, context)
            : context.json({ error: String(error) }, 500),
      });

      const response = await app.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
    });
  });
});

describe("given an evaluate door and a body that is JSON but not an evaluation", () => {
  const sendBody = (path: string, body: unknown) => {
    const runtime = createRestRuntime({
      authorization: restTestAuthorization(),
      identity: {
        authenticate: () => ({
          actor: { type: "user", id: "user-1" },
          scope: { tier: "project", id: PROJECT_ID },
        }),
      },
    });
    const app = runtime.mount(evaluationsLegacyRest.router(), {
      app: () =>
        createApiFixture<EvaluationApi>({
          findMonitorBySlug: () => Promise.resolve(null),
          listCustomEvaluators: () => Promise.resolve([]),
        }),
      onError: (error, context) => context.json({ error: String(error) }, 500),
    });

    return app.fetch(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  };

  describe("when the body omits the data the evaluator scores", () => {
    /** @scenario "An evaluate request that fails validation answers 400 with the sentence" */
    it("answers 400 with the validation sentence under error", async () => {
      loggerSpies.error.mockClear();

      const response = await sendBody("/api/evaluations/langevals/valid_format/evaluate", {
        settings: {},
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: unknown };
      expect(typeof body.error).toBe("string");
      expect(body.error).toContain("data");
      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given an evaluate door reached with the evaluator in the path", () => {
  it.each([
    ["/api/evaluations/basic/evaluate", "basic"],
    ["/api/evaluations/langevals/valid_format/evaluate", "langevals/valid_format"],
    ["/api/guardrails/basic/evaluate", "basic"],
  ])("resolves %s from the path value alone", async (path, slug) => {
    const findMonitorBySlug = vi.fn(() => Promise.resolve(null));
    const runtime = createRestRuntime({
      authorization: restTestAuthorization(),
      identity: {
        authenticate: () => ({
          actor: { type: "user", id: "user-1" },
          scope: { tier: "project", id: PROJECT_ID },
        }),
      },
    });
    const app = runtime.mount(evaluationsLegacyRest.router(), {
      app: () =>
        createApiFixture<EvaluationApi>({
          findMonitorBySlug,
          listCustomEvaluators: () => Promise.resolve([]),
        }),
      onError: (error, context) => context.json({ error: String(error) }, 500),
    });

    await app.fetch(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { input: "hi" } }),
      }),
    );

    expect(findMonitorBySlug).toHaveBeenCalledWith(expect.objectContaining({ slug }));
  });
});

describe("given an evaluate call whose evaluator ran", () => {
  describe("when the event pipeline refuses the verdict", () => {
    /** @scenario "An evaluate call whose verdict cannot be recorded answers a retryable 503" */
    it("answers a retryable 503 instead of a 200 for a verdict never stored", async () => {
      const runtime = createRestRuntime({
        authorization: restTestAuthorization(),
        identity: {
          authenticate: () => ({
            actor: { type: "user", id: "user-1" },
            scope: { tier: "project", id: PROJECT_ID },
          }),
        },
      });
      const reportEvaluation = vi.fn(() =>
        Promise.reject(new Error("Cannot send to queue after its drain has finished")),
      );
      const app = runtime.mount(evaluationsLegacyRest.router(), {
        app: () =>
          createApiFixture<EvaluationApi>({
            findMonitorBySlug: () => Promise.resolve(null),
            listCustomEvaluators: () => Promise.resolve([]),
            findModelForFeature: () => Promise.resolve(null),
            runEvaluator: () =>
              Promise.resolve({ status: "processed", score: 1, passed: true } as never),
            reportEvaluation,
          }),
        onError: (error, context) =>
          HandledError.isHandled(error)
            ? canonicalErrorResponse(error, context)
            : context.json({ error: String(error) }, 500),
      });

      const response = await app.fetch(
        new Request("http://api.test/api/evaluations/langevals/valid_format/evaluate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: { input: "hi", output: "hello" }, settings: {} }),
        }),
      );

      expect(reportEvaluation).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(503);
      // A platform fault: the envelope masks the code, and keeps the status and the retry hint.
      await expect(response.json()).resolves.toMatchObject({ retryable: true });
    });
  });
});

type EvaluatorError = Extract<SingleEvaluationResult, { status: "error" }>;

describe("given an evaluate call whose evaluator answered an error", () => {
  /** `details` is typed required but evaluators can omit it (#8507); the one cast lives here. */
  const withoutDetails: Omit<EvaluatorError, "details"> = {
    status: "error",
    error_type: "EVALUATOR_ERROR",
    traceback: [],
  };
  const evaluatorError = (details?: string): SingleEvaluationResult =>
    details === undefined
      ? (withoutDetails as EvaluatorError)
      : { status: "error", error_type: "EVALUATOR_ERROR", details, traceback: [] };

  const evaluate = async (result: SingleEvaluationResult) => {
    const runEvaluator = vi.fn(() => Promise.resolve(result));
    const runtime = createRestRuntime({
      authorization: restTestAuthorization(),
      identity: {
        authenticate: () => ({
          actor: { type: "user", id: "user-1" },
          scope: { tier: "project", id: PROJECT_ID },
        }),
      },
    });
    const app = runtime.mount(evaluationsLegacyRest.router(), {
      app: () =>
        createApiFixture<EvaluationApi>({
          findMonitorBySlug: () => Promise.resolve(null),
          listCustomEvaluators: () => Promise.resolve([]),
          findModelForFeature: () => Promise.resolve(null),
          runEvaluator,
          reportEvaluation: () => Promise.resolve(),
        }),
      onError: (error, context) => context.json({ error: String(error) }, 500),
    });
    const response = await app.fetch(
      new Request("http://api.test/api/evaluations/langevals/valid_format/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { input: "hi", output: "hello" }, settings: {} }),
      }),
    );
    return { response, runEvaluator };
  };

  describe("when the error carries no details", () => {
    it("answers the evaluator's error once, without a run failure", async () => {
      loggerSpies.error.mockClear();

      const { response, runEvaluator } = await evaluate(evaluatorError());

      expect(response.status).toBe(200);
      const body = (await response.json()) as { status?: unknown; details?: unknown };
      expect(body.status).toBe("error");
      expect(body.details).toBeUndefined();
      expect(runEvaluator).toHaveBeenCalledOnce();
      expect(loggerSpies.error).not.toHaveBeenCalledWith(
        expect.anything(),
        "error running evaluation",
      );
    });
  });

  describe("when the error says the evaluator timed out", () => {
    it("runs the evaluator once more", async () => {
      const { runEvaluator } = await evaluate(evaluatorError("Evaluator request timed out"));

      expect(runEvaluator).toHaveBeenCalledTimes(2);
    });
  });
});
