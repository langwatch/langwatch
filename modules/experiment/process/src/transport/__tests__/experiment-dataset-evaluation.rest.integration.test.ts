/**
 * @vitest-environment node
 * What `POST /api/dataset/evaluate` answers for each outcome: main's statuses
 * and bodies, byte for byte, now that experiment serves it.
 * @see modules/experiment/specs/experiment-dataset-evaluation.feature
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { EvaluationRestExperimentNotFoundError } from "@langwatch/evaluation-contract";
import type {
  DatasetEvaluationInput,
  DatasetEvaluationOutcome,
  ExperimentApi,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type * as observabilityModule from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { experimentDatasetEvaluationRest } from "../experiment-dataset-evaluation.rest.ts";

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

const BODY = {
  evaluation: "ragas/faithfulness",
  datasetSlug: "golden-set",
  batchId: "nightly",
  data: { input: "hi", output: "hello" },
};

/** The door over an experiment App answering `evaluateDataset` as given. */
function mount(evaluateDataset: ExperimentApi["evaluateDataset"], refused: unknown[] = []) {
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });
  const app = runtime.mount(experimentDatasetEvaluationRest.router(), {
    app: () => createApiFixture<ExperimentApi>({ evaluateDataset }),
    onError: (error, context) => {
      refused.push(error);
      if (HandledError.isHandled(error)) return canonicalErrorResponse(error, context);

      return context.json({ error: String(error) }, 500);
    },
  });

  return (body: string, contentType = "application/json") =>
    app.fetch(
      new Request("http://api.test/api/dataset/evaluate", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      }),
    );
}

const answering = (outcome: DatasetEvaluationOutcome) => mount(async () => outcome);

describe("given the dataset evaluation door", () => {
  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it.each([
    [
      { outcome: "evaluator_not_found", checkType: "nope" },
      400,
      '{"error":"Evaluator not found: nope"}',
    ],
    [
      { outcome: "missing_field", checkType: "ragas/faithfulness", requiredFields: ["contexts"] },
      400,
      '{"error":"Missing required field for ragas/faithfulness","requiredFields":["contexts"]}',
    ],
    [
      { outcome: "invalid_data", sentence: "Validation error" },
      400,
      '{"error":"Validation error"}',
    ],
    [{ outcome: "dataset_not_found" }, 404, '{"error":"Dataset not found"}'],
    [
      { outcome: "evaluated", result: { status: "processed", score: 1, passed: true } },
      200,
      '{"status":"processed","score":1,"passed":true}',
    ],
  ] satisfies [DatasetEvaluationOutcome, number, string][])(
    "answers %o with main's status and body",
    async (outcome, status, body) => {
      const response = await answering(outcome)(JSON.stringify(BODY));

      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      await expect(response.text()).resolves.toBe(body);
    },
  );

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("answers a body not sent as JSON with the framework's 400 malformed_request before the handler", async () => {
    const response = await mount(async () => {
      throw new Error("the handler must not run");
    })("{}", "text/plain");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
  });

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("answers a body that is not an evaluation with the validation sentence under error", async () => {
    loggerSpies.error.mockClear();

    const response = await mount(async () => {
      throw new Error("the handler must not run");
    })(JSON.stringify({ evaluation: "ragas/faithfulness" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: unknown };
    expect(body.error).toContain("datasetSlug");
    expect(loggerSpies.error).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A dataset evaluation's experiment slug resolves through the experiment owner" */
  it("hands experiment the batch id as the experiment slug when no experimentSlug is named", async () => {
    const asked: DatasetEvaluationInput[] = [];
    const response = await mount(async (input) => {
      asked.push(input);

      return { outcome: "dataset_not_found" };
    })(JSON.stringify(BODY));

    expect(response.status).toBe(404);
    expect(asked).toEqual([
      {
        projectId: PROJECT_ID,
        evaluation: "ragas/faithfulness",
        datasetSlug: "golden-set",
        experimentSlug: "nightly",
        data: { input: "hi", output: "hello" },
      },
    ]);
  });

  /** @scenario "A dataset evaluation's experiment slug resolves through the experiment owner" */
  it("leaves an unknown experiment to the family's boundary as not_found", async () => {
    const refused: unknown[] = [];
    await mount(async () => {
      throw new EvaluationRestExperimentNotFoundError("nightly");
    }, refused)(JSON.stringify(BODY));

    expect(refused).toHaveLength(1);
    expect(HandledError.isHandled(refused[0]) && refused[0].code).toBe("not_found");
  });
});
