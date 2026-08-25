import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBatchRuns, tallyBatchRuns } from "../batchRunProgress";

/**
 * `--wait` polls for the state of a batch of simulation runs.
 *
 * It used to poll `GET /api/scenario-events?batchRunId=`, which no route
 * serves: that app registers two POSTs and a DELETE and nothing else. So the
 * flag never worked — every poll 404'd, the failure budget ran out, and the
 * wait ended by blaming the status endpoint for being down.
 *
 * The stub below is the point of these tests: it serves exactly the routes the
 * app really registers, and answers 404 for anything else. A caller reaching
 * for a path that does not exist fails here the same way it failed in
 * production, rather than passing against a mock built to agree with it.
 */

const mockFetch = vi.fn();

/** Only what `platform/app/src/app/api/**` actually registers. */
const REGISTERED = new Set([
  "POST /api/scenario-events",
  "POST /api/scenario-events/browser-tab",
  "DELETE /api/scenario-events",
  "GET /api/simulation-runs",
]);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// The real endpoint stamps every run with its batch id; the stub does too,
// because fetchBatchRuns keeps only the batch's own runs.
const run = (status: string, verdict?: string | null, batchRunId = "batch_1") => ({
  batchRunId,
  status,
  results: verdict === undefined ? null : { verdict },
});

/** Pages keyed by the cursor that asks for them. */
const serveRuns = (
  pages: Record<string, { runs: unknown[]; hasMore?: boolean; nextCursor?: string }>,
) => {
  mockFetch.mockImplementation((input: URL | string, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    if (!REGISTERED.has(key)) {
      return Promise.resolve(json({ error: "Not Found" }, 404));
    }
    const cursor = url.searchParams.get("cursor") ?? "";
    return Promise.resolve(json(pages[cursor] ?? { runs: [] }));
  });
};

describe("batch run progress", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given a batch whose runs are spread over several pages", () => {
    /** @scenario "A batch larger than one page is counted in full" */
    it("follows the cursor to the end", async () => {
      serveRuns({
        "": {
          runs: [run("SUCCESS"), run("FAILED")],
          hasMore: true,
          nextCursor: "c1",
        },
        c1: { runs: [run("SUCCESS")], hasMore: false },
      });

      const runs = await fetchBatchRuns({
        endpoint: "https://app.langwatch.test",
        batchRunId: "batch_1",
        headers: {},
      });

      expect(runs).toHaveLength(3);
    });

    /** @scenario "Waiting on a batch polls the endpoint that serves it" */
    it("asks the endpoint that exists, not the one that never did", async () => {
      serveRuns({ "": { runs: [] } });

      await fetchBatchRuns({
        endpoint: "https://app.langwatch.test",
        batchRunId: "batch_1",
        headers: {},
      });

      const [requested] = mockFetch.mock.calls[0] as [URL];
      expect(requested.pathname).toBe("/api/simulation-runs");
      expect(requested.searchParams.get("batchRunId")).toBe("batch_1");
    });
  });

  describe("given a server that answers with the whole project's runs", () => {
    /** @scenario "Runs from other batches never count toward the wait" */
    it("keeps only the batch's own runs", async () => {
      // Deployed servers apply the batchRunId filter only when scenarioSetId
      // is also present. Left unfiltered, the stale IN_PROGRESS run below
      // would count as in flight forever and hold the wait open until its
      // timeout.
      serveRuns({
        "": {
          runs: [
            run("SUCCESS", "success"),
            run("IN_PROGRESS", undefined, "batch_stale"),
            run("FAILED", "failure", "batch_other"),
          ],
        },
      });

      const runs = await fetchBatchRuns({
        endpoint: "https://app.langwatch.test",
        batchRunId: "batch_1",
        headers: {},
      });

      expect(runs).toHaveLength(1);
      expect(tallyBatchRuns(runs)).toEqual({
        total: 1,
        completed: 1,
        passed: 1,
        failed: 0,
      });
    });
  });

  describe("when the endpoint has no route for the path", () => {
    /** @scenario "A status endpoint that answers 404 ends the wait" */
    it("raises rather than reporting an empty batch as finished", async () => {
      // A 404 read as "zero runs" is how the old poll produced
      // `0/0 completed` and called the batch done.
      mockFetch.mockResolvedValue(json({ error: "Not Found" }, 404));

      await expect(
        fetchBatchRuns({
          endpoint: "https://app.langwatch.test",
          batchRunId: "batch_1",
          headers: {},
        }),
      ).rejects.toThrow("404");
    });
  });

  describe("given runs in every state a batch can hold", () => {
    /** @scenario "A run's state decides whether it counts as finished" */
    it("counts only the ones that have stopped", () => {
      const progress = tallyBatchRuns([
        run("SUCCESS", "success"),
        run("FAILED", "failure"),
        run("IN_PROGRESS"),
        run("PENDING"),
      ]);

      expect(progress).toEqual({
        total: 4,
        completed: 2,
        passed: 1,
        failed: 1,
      });
    });

    it("counts a stalled run as finished and failed", () => {
      // A stalled run is not coming back. Treating it as in-flight is what
      // would make `--wait` sit until its own timeout instead of reporting.
      const progress = tallyBatchRuns([run("STALLED"), run("SUCCESS", "success")]);

      expect(progress.completed).toBe(2);
      expect(progress.failed).toBe(1);
    });

    it("counts a SUCCESS with no verdict as passed", () => {
      // A scenario with no judging criteria finishes without a verdict.
      expect(tallyBatchRuns([run("SUCCESS")]).passed).toBe(1);
    });

    it("counts an inconclusive verdict as failed", () => {
      expect(tallyBatchRuns([run("SUCCESS", "inconclusive")]).failed).toBe(1);
    });
  });
});
