import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkflowsApiService, WorkflowsApiError } from "../workflows-api.service";
import { createLangWatchApiClient } from "@/internal/api/client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const requestAt = (call: number): Request =>
  mockFetch.mock.calls[call]![0] as Request;

const ENDPOINT = "https://api.langwatch.test";

const makeService = () =>
  new WorkflowsApiService({
    langwatchApiClient: createLangWatchApiClient("sk-lw-test", ENDPOINT),
    endpoint: ENDPOINT,
  });

const evaluateResponse = {
  run_id: "run_42",
  run_url: "https://app.langwatch.test/p/proj/experiments/wf?runId=run_42",
  workflow_version_id: "wfv_1",
  version: "1.3",
};

const completedStatus = {
  runId: "run_42",
  status: "completed",
  progress: 1,
  total: 1,
  summary: {
    runId: "run_42",
    totalCells: 1,
    completedCells: 1,
    failedCells: 0,
    duration: 800,
  },
};

const resultsResponse = {
  experimentId: "exp_wf",
  runId: "run_42",
  projectId: "proj_1",
  dataset: [
    {
      index: 0,
      entry: { input: "ping" },
      predicted: { output: "pong" },
      traceId: "trace_wf_0",
      duration: 800,
    },
  ],
  evaluations: [
    {
      evaluator: "contains",
      name: "contains",
      status: "processed",
      index: 0,
      score: 1,
      passed: true,
    },
  ],
  timestamps: { createdAt: 0, updatedAt: 0 },
};

describe("WorkflowsApiService.run", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = ENDPOINT;
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("given inline data is provided", () => {
    describe("when the run completes", () => {
      it("posts to the evaluate endpoint, returns the run url, and maps rows", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(evaluateResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const service = makeService();
        const result = await service.run("workflow_123", {
          data: [{ input: "ping" }],
          pollInterval: 0,
        });

        // 1) evaluate
        const startReq = requestAt(0);
        expect(startReq.method).toBe("POST");
        expect(startReq.url).toBe(
          `${ENDPOINT}/api/workflows/workflow_123/evaluate`,
        );
        expect(await startReq.clone().json()).toEqual({
          data: [{ input: "ping" }],
        });

        // 2) poll v3 run status
        expect(requestAt(1).url).toBe(
          `${ENDPOINT}/api/evaluations/v3/runs/run_42`,
        );

        // 3) results
        expect(requestAt(2).url).toBe(
          `${ENDPOINT}/api/evaluations/v3/runs/run_42/results`,
        );

        expect(result.runId).toBe("run_42");
        expect(result.status).toBe("completed");
        // The run URL is rebased onto the configured endpoint, not the
        // platform's own (cloud) domain. Fixtures use app.langwatch.test; the
        // endpoint is api.langwatch.test.
        expect(result.runUrl).toContain("/experiments/wf?runId=run_42");
        expect(result.runUrl).toContain(ENDPOINT);
        expect(result.runUrl).not.toContain("app.langwatch.test");
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          index: 0,
          input: { input: "ping" },
          output: "pong",
          traceId: "trace_wf_0",
          evaluations: { contains: { score: 1, passed: true } },
        });
      });
    });
  });

  describe("given a committed version override", () => {
    describe("when the run completes", () => {
      it("includes version_id in the evaluate body", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(evaluateResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const service = makeService();
        await service.run("workflow_123", {
          versionId: "wfv_7",
          datasetId: "ds_1",
          pollInterval: 0,
        });

        expect(await requestAt(0).clone().json()).toEqual({
          version_id: "wfv_7",
          dataset_id: "ds_1",
        });
      });
    });
  });

  describe("given the workflow is unknown", () => {
    describe("when the evaluate call returns 404", () => {
      it("throws a WorkflowsApiError with operation context", async () => {
        mockFetch.mockResolvedValueOnce(
          jsonResponse({ error: "Workflow not found" }, { status: 404 }),
        );

        const service = makeService();
        const err = await service
          .run("missing", { data: [{ input: "x" }], pollInterval: 0 })
          .catch((e) => e);

        expect(err).toBeInstanceOf(WorkflowsApiError);
        expect((err as WorkflowsApiError).operation).toContain("missing");
      });
    });
  });

  describe("given there is no committed version", () => {
    describe("when the evaluate call returns 400", () => {
      it("throws a WorkflowsApiError", async () => {
        mockFetch.mockResolvedValueOnce(
          jsonResponse(
            { error: "No committed version to evaluate" },
            { status: 400 },
          ),
        );

        const service = makeService();
        const err = await service
          .run("workflow_123", { pollInterval: 0 })
          .catch((e) => e);

        expect(err).toBeInstanceOf(WorkflowsApiError);
      });
    });
  });

  describe("given the results lag behind completion", () => {
    describe("when the first results fetch is empty", () => {
      it("retries until the rows materialize", async () => {
        const emptyResults = {
          ...resultsResponse,
          dataset: [],
          evaluations: [],
        };
        mockFetch
          .mockResolvedValueOnce(jsonResponse(evaluateResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(emptyResults))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const service = makeService();
        const result = await service.run("workflow_123", {
          data: [{ input: "ping" }],
          pollInterval: 0,
        });

        // evaluate + poll + results (empty) + results (materialized)
        expect(mockFetch).toHaveBeenCalledTimes(4);
        expect(result.rows).toHaveLength(1);
      });
    });

    describe("when the first results fetch 404s", () => {
      it("retries until the results are available", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(evaluateResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(
            jsonResponse({ error: "not yet available" }, { status: 404 }),
          )
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const service = makeService();
        const result = await service.run("workflow_123", {
          data: [{ input: "ping" }],
          pollInterval: 0,
        });

        expect(result.rows).toHaveLength(1);
      });
    });
  });
});
