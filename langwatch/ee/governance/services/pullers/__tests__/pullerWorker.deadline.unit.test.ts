/**
 * The per-run deadline has to be enforceable, not advisory.
 *
 * The scheduler abandons a run it considers stale
 * (INGESTION_PULL_STALE_RUN_MS) and starts a fresh one from the same cursor.
 * That is only safe if the abandoned run is provably finished. If a hung
 * adapter could keep executing, two pulls would read the same window
 * concurrently, both could write the same events, and whichever settled last
 * would decide the durable cursor.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullResult, PullRunOptions } from "../pullerAdapter";

const sourceFindUnique = vi.fn();
const sourceUpdate = vi.fn();
const ensureGovProject = vi.fn();

beforeEach(() => {
  sourceFindUnique.mockReset();
  sourceUpdate.mockReset();
  ensureGovProject.mockReset();
  ensureGovProject.mockResolvedValue({ id: "gov-proj-1" });

  vi.doMock("~/server/db", () => ({
    prisma: {
      ingestionSource: { findUnique: sourceFindUnique, update: sourceUpdate },
    },
  }));
  vi.doMock("~/server/clickhouse/clickhouseClient", () => ({
    getClickHouseClientForProject: async () => ({}),
  }));
  vi.doMock("../../governanceOcsfEvents.clickhouse.repository", () => ({
    GovernanceOcsfEventsClickHouseRepository: class {
      async insertEvent() {
        return undefined;
      }
    },
    OCSF_ACTIVITY: { CREATE: 1, READ: 2, UPDATE: 3, DELETE: 4, INVOKE: 6 },
    OCSF_SEVERITY: { INFO: 1, LOW: 3, MEDIUM: 4, HIGH: 5, CRITICAL: 6 },
  }));
  vi.doMock("../../governanceProject.service", () => ({
    ensureHiddenGovernanceProject: ensureGovProject,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
});

/**
 * An adapter whose pull never settles on its own — the S3 case the review
 * flagged, where a hung `client.send()` or a stalled body stream has no
 * transport timeout of its own.
 */
function hangingAdapter() {
  const seen: { signal?: AbortSignal } = {};
  let started: () => void;
  const hasStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  return {
    seen,
    hasStarted,
    adapter: {
      id: "test_hanging",
      validateConfig: (config: unknown) => config,
      runOnce(options: PullRunOptions): Promise<PullResult> {
        seen.signal = options.signal;
        started();
        // Never resolves. Only an abort can end this run.
        return new Promise<PullResult>(() => undefined);
      },
    },
  };
}

async function loadWorkerWith(adapter: { id: string }) {
  const { pullerAdapterRegistry } = await import("../pullerAdapter");
  pullerAdapterRegistry.register(adapter as never);
  return import("../pullerWorker");
}

describe("given an adapter whose pull never settles", () => {
  describe("when the run reaches its deadline", () => {
    it("fails the run instead of executing indefinitely", async () => {
      vi.useFakeTimers();
      const { adapter, hasStarted } = hangingAdapter();
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-hang-1",
        organizationId: "org-1",
        sourceType: "test_hanging",
        status: "active",
        parserConfig: { adapter: "test_hanging" },
        pollerCursor: "cursor-A",
      });

      const { runIngestionPull, IngestionPullDeadlineExceededError } =
        await loadWorkerWith(adapter);

      const run = runIngestionPull({
        sourceId: "src-hang-1",
        cursor: "cursor-A",
      });
      const settled = run.then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );

      await hasStarted;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      const outcome = await settled;
      expect(outcome.ok).toBe(false);
      expect(outcome).toMatchObject({
        error: expect.any(IngestionPullDeadlineExceededError),
      });
    });

    it("aborts the adapter's transport, so the run cannot still be pulling", async () => {
      // This is the property that makes supersede-and-restart safe: by the
      // time the scheduler could start run 2, run 1's transport is cancelled.
      vi.useFakeTimers();
      const { adapter, seen, hasStarted } = hangingAdapter();
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-hang-2",
        organizationId: "org-1",
        sourceType: "test_hanging",
        status: "active",
        parserConfig: { adapter: "test_hanging" },
        pollerCursor: "cursor-A",
      });

      const { runIngestionPull } = await loadWorkerWith(adapter);

      const run = runIngestionPull({
        sourceId: "src-hang-2",
        cursor: "cursor-A",
      }).catch(() => undefined);

      await hasStarted;
      expect(seen.signal).toBeDefined();
      expect(seen.signal!.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      await run;

      expect(seen.signal!.aborted).toBe(true);
    });

    it("leaves the durable cursor untouched so the window is retried", async () => {
      vi.useFakeTimers();
      const { adapter, hasStarted } = hangingAdapter();
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-hang-3",
        organizationId: "org-1",
        sourceType: "test_hanging",
        status: "active",
        parserConfig: { adapter: "test_hanging" },
        pollerCursor: "cursor-A",
      });

      const { runIngestionPull } = await loadWorkerWith(adapter);

      const run = runIngestionPull({
        sourceId: "src-hang-3",
        cursor: "cursor-A",
      }).catch(() => undefined);

      await hasStarted;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      await run;

      expect(sourceUpdate).not.toHaveBeenCalled();
    });
  });
});
