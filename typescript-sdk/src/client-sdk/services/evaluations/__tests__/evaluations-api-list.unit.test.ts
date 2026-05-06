import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EvaluationsApiService,
  EvaluationsApiError,
  type ExperimentListResponse,
  type EvaluationRunsListResponse,
} from "../evaluations-api.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("EvaluationsApiService list endpoints", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://api.langwatch.test";
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("listExperiments", () => {
    describe("given the API returns a valid payload", () => {
      describe("when called without arguments", () => {
        it("hits /api/experiments with no query string", async () => {
          const payload: ExperimentListResponse = {
            experiments: [],
            pagination: {
              page: 1,
              pageSize: 50,
              totalHits: 0,
              hasMore: false,
            },
          };
          mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(payload),
          });

          const service = new EvaluationsApiService();
          const result = await service.listExperiments();

          expect(result).toEqual(payload);
          const url = mockFetch.mock.calls[0]![0] as string;
          expect(url).toBe("https://api.langwatch.test/api/experiments");
        });
      });

      describe("when called with pageSize and page", () => {
        it("includes them in the query string", async () => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ experiments: [], pagination: {} }),
          });

          const service = new EvaluationsApiService();
          await service.listExperiments({ pageSize: 10, page: 2 });

          const url = mockFetch.mock.calls[0]![0] as string;
          expect(url).toContain("pageSize=10");
          expect(url).toContain("page=2");
        });
      });
    });

    describe("given the API returns 401", () => {
      describe("when called", () => {
        it("throws EvaluationsApiError with 'list experiments' operation", async () => {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve('{"error":"Missing credentials"}'),
          });

          const service = new EvaluationsApiService();
          const err = await service.listExperiments().catch((e) => e);

          expect(err).toBeInstanceOf(EvaluationsApiError);
          expect((err as EvaluationsApiError).operation).toBe(
            "list experiments",
          );
        });
      });
    });
  });

  describe("listRuns", () => {
    describe("given a valid experiment slug", () => {
      describe("when called", () => {
        it("hits the runs endpoint with experimentSlug query param", async () => {
          const payload: EvaluationRunsListResponse = {
            experimentId: "exp_1",
            experimentSlug: "checkout-flow",
            runs: [],
            pagination: {
              page: 1,
              pageSize: 50,
              totalHits: 0,
              hasMore: false,
            },
          };
          mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(payload),
          });

          const service = new EvaluationsApiService();
          const result = await service.listRuns({
            experimentSlug: "checkout-flow",
          });

          expect(result).toEqual(payload);
          const url = mockFetch.mock.calls[0]![0] as string;
          expect(url).toContain(
            "/api/evaluations/v3/runs?experimentSlug=checkout-flow",
          );
        });
      });
    });

    describe("given the experiment slug is unknown", () => {
      describe("when the API returns 404", () => {
        it("throws EvaluationsApiError mentioning the slug", async () => {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            text: () => Promise.resolve('{"error":"Experiment not found"}'),
          });

          const service = new EvaluationsApiService();
          const err = await service
            .listRuns({ experimentSlug: "missing" })
            .catch((e) => e);

          expect(err).toBeInstanceOf(EvaluationsApiError);
          expect((err as EvaluationsApiError).operation).toContain("missing");
        });
      });
    });

    describe("given a network failure", () => {
      describe("when fetch rejects", () => {
        it("wraps the error as EvaluationsApiError", async () => {
          mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
          const service = new EvaluationsApiService();
          const err = await service
            .listRuns({ experimentSlug: "checkout-flow" })
            .catch((e) => e);
          expect(err).toBeInstanceOf(EvaluationsApiError);
        });
      });
    });
  });
});
