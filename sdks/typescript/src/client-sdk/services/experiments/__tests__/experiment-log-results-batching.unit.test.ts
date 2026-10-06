/**
 * log_results requests are sized by bytes. The experiment posts to a stubbed fetch, so the
 * sizes asserted here are the sizes of the request bodies actually sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangWatch } from "@/client-sdk";
import { NoOpLogger } from "@/logger";

import { LOG_RESULTS_TARGET_BYTES } from "../log-results-batching";
import { type LogResultsRequest } from "../types";

const MB = 1024 * 1024;

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type FakeServer = {
  bodies: LogResultsRequest[];
  sizes: number[];
  refusedSizes: number[];
};

/** Answers experiment init, records log_results requests and refuses bodies above its limit. */
function serve({ limitBytes }: { limitBytes?: number } = {}): FakeServer {
  const server: FakeServer = { bodies: [], sizes: [], refusedSizes: [] };

  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/api/v1/experiment/init")) {
      return Response.json({ slug: "image-rows", path: "/acme/experiments/image-rows" });
    }
    if (!request.url.endsWith("/api/v1/evaluations/batch/log_results")) {
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    const text = await request.text();
    const size = new TextEncoder().encode(text).length;
    if (limitBytes !== undefined && size > limitBytes) {
      server.refusedSizes.push(size);
      return Response.json(
        { code: "payload_too_large", message: "Too large" },
        { status: 413 },
      );
    }
    server.sizes.push(size);
    server.bodies.push(JSON.parse(text) as LogResultsRequest);
    return Response.json({ message: "ok" });
  });

  return server;
}

class RecordingLogger extends NoOpLogger {
  readonly errors: string[] = [];

  override error = (...parts: unknown[]): void => {
    this.errors.push(parts.map(String).join(" "));
  };
}

/** Runs an experiment over one row per size, each with an inline image of that many megabytes. */
async function runExperiment(rowMegabytes: number[], logger = new RecordingLogger()) {
  const langwatch = new LangWatch({
    apiKey: "sk-lw-test",
    endpoint: "http://langwatch.test",
    options: { logger },
  });
  const experiment = await langwatch.experiments.init("image-rows");
  const rows = rowMegabytes.map((megabytes) => ({ image: "x".repeat(megabytes * MB) }));

  await experiment.run(
    rows,
    ({ index }) => {
      experiment.log("accuracy", { index, score: 1 });
    },
    { concurrency: 1 },
  );

  return { experiment, logger };
}

const rowIndexes = (server: FakeServer) =>
  server.bodies.flatMap((body) => body.dataset.map((row) => row.index));

const evaluationIndexes = (server: FakeServer) =>
  server.bodies.flatMap((body) => body.evaluations.map((evaluation) => evaluation.index));

const finishedFlags = (server: FakeServer) =>
  server.bodies.map((body) => (body.timestamps.finished_at ?? null) !== null);

describe("Experiment log_results batching", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;

  beforeEach(() => {
    mockFetch.mockReset();
    // Left unset so ensureSetup() stays a no-op; the key is passed explicitly.
    delete process.env.LANGWATCH_API_KEY;
  });

  afterEach(() => {
    if (previousApiKey !== undefined) process.env.LANGWATCH_API_KEY = previousApiKey;
  });

  describe("given results that add up to more than the request target", () => {
    describe("when the experiment finishes", () => {
      /** @scenario "A logResults batch larger than the request target is sent as several requests" */
      it("sends several requests, each under the target", async () => {
        const server = serve();

        await runExperiment([5, 5, 5, 5, 5, 5, 5]);

        expect(server.bodies.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...server.sizes)).toBeLessThanOrEqual(LOG_RESULTS_TARGET_BYTES + 64 * 1024);
      });

      /** @scenario "Split logResults requests keep the results in their original order" */
      it("keeps rows and evaluations in order", async () => {
        const server = serve();

        const { experiment } = await runExperiment([5, 5, 5, 5, 5, 5, 5]);

        expect(rowIndexes(server)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(evaluationIndexes(server)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(new Set(server.bodies.map((body) => body.run_id))).toEqual(
          new Set([experiment.runId]),
        );
      });

      /** @scenario "Only the last split logResults request marks the run as finished" */
      it("marks only the last request as finished", async () => {
        const server = serve();

        await runExperiment([5, 5, 5, 5, 5, 5, 5]);

        const flags = finishedFlags(server);
        expect(flags.at(-1)).toBe(true);
        expect(flags.slice(0, -1)).not.toContain(true);
      });
    });
  });

  describe("given a single result larger than the request target", () => {
    describe("when the experiment finishes", () => {
      /** @scenario "A single result larger than the logResults request target is sent alone" */
      it("sends it in a request of its own", async () => {
        const server = serve();

        await runExperiment([1, 18, 1]);

        const large = server.bodies.find((body) => body.dataset.some((row) => row.index === 1));
        expect(large?.dataset).toHaveLength(1);
        expect(rowIndexes(server)).toEqual([0, 1, 2]);
      });
    });
  });

  describe("given a server with a lower request limit", () => {
    describe("when it refuses a request holding several results", () => {
      /** @scenario "A logResults request refused as too large is split and sent again" */
      it("cuts the request in two and logs every result", async () => {
        const server = serve({ limitBytes: 8 * MB });

        await runExperiment([3, 3, 3, 3, 3]);

        expect(server.refusedSizes.length).toBeGreaterThanOrEqual(1);
        expect(rowIndexes(server)).toEqual([0, 1, 2, 3, 4]);
        expect(evaluationIndexes(server)).toEqual([0, 1, 2, 3, 4]);
        expect(Math.max(...server.sizes)).toBeLessThanOrEqual(8 * MB);
        const flags = finishedFlags(server);
        expect(flags.at(-1)).toBe(true);
        expect(flags.slice(0, -1)).not.toContain(true);
      });
    });

    describe("when it refuses a single result", () => {
      /** @scenario "A single result the server refuses as too large is reported with its size" */
      it("logs an error naming the row and its size, and still finishes the run", async () => {
        const server = serve({ limitBytes: 4 * MB });

        const { logger } = await runExperiment([1, 6, 1]);

        expect(logger.errors).toHaveLength(1);
        expect(logger.errors[0]).toContain("row index 1");
        expect(logger.errors[0]).toContain("6.0 MB");
        expect(logger.errors[0]).toContain("413");
        expect(rowIndexes(server)).toEqual([0, 2]);
        expect(finishedFlags(server).at(-1)).toBe(true);
      });
    });
  });
});
