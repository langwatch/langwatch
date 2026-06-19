import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExperimentsFacade } from "../experiments.facade";
import { createLangWatchApiClient } from "@/internal/api/client";
import { NoOpLogger } from "@/logger";

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

const makeFacade = () =>
  new ExperimentsFacade({
    langwatchApiClient: createLangWatchApiClient("sk-lw-test", ENDPOINT),
    endpoint: ENDPOINT,
    apiKey: "sk-lw-test",
    logger: new NoOpLogger(),
  });

const startResponse = {
  runId: "run_1",
  status: "running",
  total: 1,
  runUrl: "https://app.langwatch.test/p/proj/experiments/exp?runId=run_1",
};

const completedStatus = {
  runId: "run_1",
  status: "completed",
  progress: 1,
  total: 1,
  summary: {
    runId: "run_1",
    totalCells: 1,
    completedCells: 1,
    failedCells: 0,
    duration: 1200,
    runUrl: "https://app.langwatch.test/p/proj/experiments/exp?runId=run_1",
  },
};

const resultsResponse = {
  experimentId: "exp_1",
  runId: "run_1",
  projectId: "proj_1",
  dataset: [
    {
      index: 0,
      entry: { question: "What is 2 + 2?" },
      predicted: { output: "4" },
      traceId: "trace_0",
      cost: 0.01,
      duration: 1200,
    },
  ],
  evaluations: [
    {
      evaluator: "exact_match",
      name: "exact_match",
      status: "processed",
      index: 0,
      score: 1,
      passed: true,
    },
  ],
  timestamps: { createdAt: 0, updatedAt: 0 },
};

describe("ExperimentsFacade.runWithResults", () => {
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
      it("posts to the v3 run endpoint with the data body and maps the rows", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(startResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const facade = makeFacade();
        const result = await facade.runWithResults("my-experiment", {
          data: [{ question: "What is 2 + 2?" }],
          pollInterval: 0,
        });

        // 1) start
        const startReq = requestAt(0);
        expect(startReq.method).toBe("POST");
        expect(startReq.url).toBe(
          `${ENDPOINT}/api/evaluations/v3/my-experiment/run`,
        );
        expect(await startReq.clone().json()).toEqual({
          data: [{ question: "What is 2 + 2?" }],
        });

        // 2) poll
        expect(requestAt(1).url).toBe(
          `${ENDPOINT}/api/evaluations/v3/runs/run_1`,
        );

        // 3) results (with experimentSlug)
        expect(requestAt(2).url).toBe(
          `${ENDPOINT}/api/evaluations/v3/runs/run_1/results?experimentSlug=my-experiment`,
        );

        expect(result.runId).toBe("run_1");
        expect(result.status).toBe("completed");
        expect(result.runUrl).toContain("/experiments/exp?runId=run_1");
        // The run URL is rebased onto the configured endpoint, not the
        // platform's own (cloud) domain, so a self-hosted run gets a local
        // link. The fixtures use app.langwatch.test; the endpoint is
        // api.langwatch.test.
        expect(result.runUrl).toContain(ENDPOINT);
        expect(result.runUrl).not.toContain("app.langwatch.test");
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          index: 0,
          input: { question: "What is 2 + 2?" },
          output: "4",
          traceId: "trace_0",
          evaluations: { exact_match: { score: 1, passed: true } },
        });
      });
    });
  });

  describe("given parameter overrides are provided", () => {
    describe("when the run completes", () => {
      it("posts the parameters body", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(startResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const facade = makeFacade();
        const result = await facade.runWithResults("my-experiment", {
          parameters: { model: "gpt-5-mini", temperature: 0 },
          pollInterval: 0,
        });

        expect(await requestAt(0).clone().json()).toEqual({
          parameters: { model: "gpt-5-mini", temperature: 0 },
        });
        expect(result.rows[0]!.evaluations).toEqual({
          exact_match: { score: 1, passed: true },
        });
      });
    });
  });

  describe("given no overrides are provided", () => {
    describe("when the run completes", () => {
      it("posts a body-less start request", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(startResponse))
          .mockResolvedValueOnce(jsonResponse(completedStatus))
          .mockResolvedValueOnce(jsonResponse(resultsResponse));

        const facade = makeFacade();
        await facade.runWithResults("my-experiment", { pollInterval: 0 });

        const startReq = requestAt(0);
        const rawBody = await startReq.clone().text();
        expect(rawBody).toBe("");
      });
    });
  });

  describe("given the run fails", () => {
    describe("when polling reports a failed status", () => {
      it("throws an ExperimentRunFailedError", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(startResponse))
          .mockResolvedValueOnce(
            jsonResponse({
              runId: "run_1",
              status: "failed",
              progress: 0,
              total: 1,
              error: "execution exploded",
            }),
          );

        const facade = makeFacade();
        const err = await facade
          .runWithResults("my-experiment", { pollInterval: 0 })
          .catch((e) => e);

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("execution exploded");
      });
    });
  });
});
