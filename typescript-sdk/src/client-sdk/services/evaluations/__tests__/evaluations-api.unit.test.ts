import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EvaluationsApiService,
  EvaluationsApiError,
  type EvaluationRunResultsResponse,
} from "../evaluations-api.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("EvaluationsApiService.getRunResults()", () => {
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
        const payload: EvaluationRunResultsResponse = {
          experimentId: "exp_1",
          runId: "run_1",
          projectId: "proj_1",
          dataset: [],
          evaluations: [],
          timestamps: { createdAt: 0, updatedAt: 0 },
        };
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(payload),
        });

        const service = new EvaluationsApiService();
        const result = await service.getRunResults({ runId: "run_1" });

        expect(result).toEqual(payload);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.langwatch.test/api/evaluations/v3/runs/run_1/results",
          expect.objectContaining({ method: "GET" }),
        );
      });

      it("url-encodes the run id", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });

        const service = new EvaluationsApiService();
        await service.getRunResults({ runId: "run/with slash" });

        const url = mockFetch.mock.calls[0]![0] as string;
        expect(url).toContain("run%2Fwith%20slash/results");
      });
    });
  });

  describe("given the API returns an error", () => {
    describe("when the run is missing", () => {
      it("throws EvaluationsApiError with operation context", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve('{"error":"Run not found"}'),
        });

        const service = new EvaluationsApiService();
        const err = await service
          .getRunResults({ runId: "missing" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(EvaluationsApiError);
        expect((err as EvaluationsApiError).operation).toContain("missing");
      });
    });

    describe("when the API returns 200 with a null body for a missing run", () => {
      it("throws EvaluationsApiError instead of crashing on null.dataset", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(null),
        });

        const service = new EvaluationsApiService();
        const err = await service
          .getRunResults({ runId: "ghost" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(EvaluationsApiError);
        expect((err as EvaluationsApiError).operation).toContain("ghost");
      });
    });

    describe("when the network call rejects", () => {
      it("wraps fetch errors in EvaluationsApiError", async () => {
        mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

        const service = new EvaluationsApiService();
        const err = await service
          .getRunResults({ runId: "run_1" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(EvaluationsApiError);
      });
    });
  });
});
