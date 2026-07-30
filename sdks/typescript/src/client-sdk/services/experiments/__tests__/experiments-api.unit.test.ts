import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ExperimentsApiService,
  ExperimentsApiServiceError,
  type ExperimentRunResultsResponse,
} from "../experiments-api.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const fetchedRequest = (): Request => mockFetch.mock.calls[0]![0] as Request;

describe("ExperimentsApiService.getRunResults()", () => {
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

  describe("given a completed run", () => {
    describe("when the API returns the payload", () => {
      it("hits the v3 results endpoint with the run id", async () => {
        const payload: ExperimentRunResultsResponse = {
          experimentId: "exp_1",
          runId: "run_1",
          projectId: "proj_1",
          dataset: [],
          evaluations: [],
          timestamps: { createdAt: 0, updatedAt: 0 },
        };
        mockFetch.mockResolvedValueOnce(jsonResponse(payload));

        const service = new ExperimentsApiService();
        const result = await service.getRunResults({ runId: "run_1" });

        expect(result).toEqual(payload);
        expect(fetchedRequest().url).toBe(
          "https://api.langwatch.test/api/experiments/runs/run_1/results",
        );
        expect(fetchedRequest().method).toBe("GET");
      });

      it("url-encodes the run id", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({}));

        const service = new ExperimentsApiService();
        await service.getRunResults({ runId: "run/with slash" });

        expect(fetchedRequest().url).toContain("run%2Fwith%20slash/results");
      });
    });
  });

  describe("given the API returns an error", () => {
    describe("when the run is missing", () => {
      it("throws ExperimentsApiServiceError with operation context", async () => {
        mockFetch.mockResolvedValueOnce(
          jsonResponse({ error: "Run not found" }, { status: 404 }),
        );

        const service = new ExperimentsApiService();
        const err = await service
          .getRunResults({ runId: "missing" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(ExperimentsApiServiceError);
        expect((err as ExperimentsApiServiceError).operation).toContain("missing");
      });
    });

    describe("when the API returns 200 with a null body for a missing run", () => {
      it("throws ExperimentsApiServiceError instead of crashing on null.dataset", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(null));

        const service = new ExperimentsApiService();
        const err = await service
          .getRunResults({ runId: "ghost" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(ExperimentsApiServiceError);
        expect((err as ExperimentsApiServiceError).operation).toContain("ghost");
      });
    });

    describe("when the network call rejects", () => {
      it("wraps fetch errors in ExperimentsApiServiceError", async () => {
        mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

        const service = new ExperimentsApiService();
        const err = await service
          .getRunResults({ runId: "run_1" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(ExperimentsApiServiceError);
      });
    });
  });
});
