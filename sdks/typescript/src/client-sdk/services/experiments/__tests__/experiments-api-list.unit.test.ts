import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ExperimentsApiService,
  ExperimentsApiServiceError,
  type ExperimentListResponse,
  type ExperimentRunsListResponse,
} from "../experiments-api.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const fetchedUrl = (): string => {
  const request = mockFetch.mock.calls[0]![0];
  return request instanceof Request ? request.url : String(request);
};

describe("ExperimentsApiService list endpoints", () => {
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
          mockFetch.mockResolvedValueOnce(jsonResponse(payload));

          const service = new ExperimentsApiService();
          const result = await service.listExperiments();

          expect(result).toEqual(payload);
          expect(fetchedUrl()).toBe(
            "https://api.langwatch.test/api/experiments",
          );
        });
      });

      describe("when called with pageSize and page", () => {
        it("includes them in the query string", async () => {
          mockFetch.mockResolvedValueOnce(
            jsonResponse({ experiments: [], pagination: {} }),
          );

          const service = new ExperimentsApiService();
          await service.listExperiments({ pageSize: 10, page: 2 });

          expect(fetchedUrl()).toContain("pageSize=10");
          expect(fetchedUrl()).toContain("page=2");
        });
      });
    });

    describe("given the API returns 401", () => {
      describe("when called", () => {
        it("throws ExperimentsApiServiceError with 'list experiments' operation", async () => {
          mockFetch.mockResolvedValueOnce(
            jsonResponse(
              { error: "Missing credentials" },
              { status: 401 },
            ),
          );

          const service = new ExperimentsApiService();
          const err = await service.listExperiments().catch((e) => e);

          expect(err).toBeInstanceOf(ExperimentsApiServiceError);
          expect((err as ExperimentsApiServiceError).operation).toBe(
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
          const payload: ExperimentRunsListResponse = {
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
          mockFetch.mockResolvedValueOnce(jsonResponse(payload));

          const service = new ExperimentsApiService();
          const result = await service.listRuns({
            experimentSlug: "checkout-flow",
          });

          expect(result).toEqual(payload);
          expect(fetchedUrl()).toContain(
            "/api/experiments/runs?experimentSlug=checkout-flow",
          );
        });
      });
    });

    describe("given the experiment slug is unknown", () => {
      describe("when the API returns 404", () => {
        it("throws ExperimentsApiServiceError mentioning the slug", async () => {
          mockFetch.mockResolvedValueOnce(
            jsonResponse(
              { error: "Experiment not found" },
              { status: 404 },
            ),
          );

          const service = new ExperimentsApiService();
          const err = await service
            .listRuns({ experimentSlug: "missing" })
            .catch((e) => e);

          expect(err).toBeInstanceOf(ExperimentsApiServiceError);
          expect((err as ExperimentsApiServiceError).operation).toContain("missing");
        });
      });
    });

    describe("given a network failure", () => {
      describe("when fetch rejects", () => {
        it("wraps the error as ExperimentsApiServiceError", async () => {
          mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
          const service = new ExperimentsApiService();
          const err = await service
            .listRuns({ experimentSlug: "checkout-flow" })
            .catch((e) => e);
          expect(err).toBeInstanceOf(ExperimentsApiServiceError);
        });
      });
    });
  });
});
