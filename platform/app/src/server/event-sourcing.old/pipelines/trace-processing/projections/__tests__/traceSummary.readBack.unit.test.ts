import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing.old/domain/tenantId";
import { FoldProjectionExecutor } from "~/server/event-sourcing.old/projections/foldProjectionExecutor";
import type { ProjectionStoreContext } from "~/server/event-sourcing.old/projections/projectionStoreContext";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { TraceSummaryStore } from "../traceSummary.store";
import {
  createInitState,
  createSpanReceivedEvent,
} from "./fixtures/trace-summary-test.fixtures";

/**
 * Read-back version gate for the trace-summary fold (ADR-099).
 *
 * `trace_summaries` is this fold's own state, so `get()` decides what the fold
 * CONTINUES FROM. A row written by a build with a different row shape decodes
 * its absent columns as ClickHouse defaults — indistinguishable from real
 * values — and the fold then carries on from state that was never true and
 * commits the result stamped at the CURRENT version, where the gate that would
 * have refused it now accepts it forever.
 *
 * The stamp before this one (`2026-04-23`) predates the span-flag (migration
 * 00020) and prompt (00021) columns, so `ContainsAi = 0` on such a row says
 * nothing about whether the trace called a model. That is the fabrication these
 * tests drive.
 */

const TENANT = "tenant-rb";
const TENANT_ID = createTenantId(TENANT);
const TRACE_ID = "aaaa0000000000000000000000000001";
const OLDER_STAMP = "2026-04-23";
const BASE_MS = 1_700_000_000_000;

const context: ProjectionStoreContext = {
  aggregateId: TRACE_ID,
  tenantId: TENANT_ID,
};

/**
 * What a pre-span-flags row decodes to: the columns it does carry are real
 * (four spans really were folded into it), the columns it does not carry come
 * back as their ClickHouse defaults.
 */
function decodedOlderRow(): TraceSummaryData {
  return {
    ...createInitState(),
    traceId: TRACE_ID,
    spanCount: 4,
    // The fabrication: this trace DID call a model, but the row has no column
    // that could say so.
    containsAi: false,
    occurredAt: BASE_MS,
  };
}

function aiSpanAt(occurredAt: number, id: string): TraceProcessingEvent {
  return createSpanReceivedEvent({
    eventId: id,
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId: id.padEnd(16, "0"),
    parentSpanId: null,
    name: "llm-call",
    occurredAt,
    attributes: { "langwatch.span.type": "llm" },
  }) as TraceProcessingEvent;
}

/** A repository that answers the version-aware read with one canned row. */
function repoOver(found: { state: TraceSummaryData; version: string } | null) {
  const findByTraceIdWithVersion = vi.fn().mockResolvedValue(found);
  const upsert = vi.fn().mockResolvedValue(undefined);
  const repo = {
    findByTraceIdWithVersion,
    upsert,
  } as unknown as TraceSummaryRepository;
  return { repo, findByTraceIdWithVersion, upsert };
}

describe("TraceSummaryStore read-back version gate", () => {
  describe("given a row stamped with the current projection version", () => {
    /** @scenario "A trace summary written by the current build is read straight back" */
    it("reads the committed state back", async () => {
      const { repo } = repoOver({
        state: { ...decodedOlderRow(), containsAi: true },
        version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
      });

      const { state, miss } = await new TraceSummaryStore(repo).getWithApplied(
        TRACE_ID,
        context,
      );

      expect(miss).toBeUndefined();
      expect(state?.spanCount).toBe(4);
      expect(state?.containsAi).toBe(true);
    });
  });

  describe("given a row stamped by an older build", () => {
    /** @scenario "A trace summary an older build wrote is refused rather than decoded" */
    it("reports an undecodable store miss instead of the decoded row", async () => {
      const { repo } = repoOver({
        state: decodedOlderRow(),
        version: OLDER_STAMP,
      });

      const { state, appliedEventIds, miss } = await new TraceSummaryStore(
        repo,
      ).getWithApplied(TRACE_ID, context);

      expect(state).toBeNull();
      // The watermark goes with the state: keeping it would suppress the very
      // events the re-fold needs to replay.
      expect(appliedEventIds).toEqual([]);
      // `undecodable`, not `absent` — the row was FOUND and refused, so the
      // executor must not answer with an unwindowed re-read that can only find
      // the same row and refuse it again.
      expect(miss).toBe("undecodable");
    });

    /** @scenario "A trace summary an older build wrote is refused rather than decoded" */
    it("misses through get() too, so both read paths agree", async () => {
      const { repo } = repoOver({
        state: decodedOlderRow(),
        version: OLDER_STAMP,
      });

      expect(
        await new TraceSummaryStore(repo).get(TRACE_ID, context),
      ).toBeNull();
    });
  });

  describe("given no row for the trace at all", () => {
    it("tells an absent row apart from a refused one", async () => {
      // The two miss kinds mean opposite things to an operator: `absent` says
      // "widen readWindow.widthMs", `undecodable` says "a stale shape is being
      // rebuilt".
      const { repo } = repoOver(null);

      const { state, miss } = await new TraceSummaryStore(repo).getWithApplied(
        TRACE_ID,
        context,
      );

      expect(state).toBeNull();
      expect(miss).toBe("absent");
    });
  });
});

describe("the trace summary fold reading its own committed row", () => {
  /** The trace's real history: four AI spans, only one of which the row records. */
  const history = [
    aiSpanAt(BASE_MS + 1, "a"),
    aiSpanAt(BASE_MS + 2, "b"),
    aiSpanAt(BASE_MS + 3, "c"),
    aiSpanAt(BASE_MS + 4, "d"),
  ];
  /**
   * Deliberately NOT an AI span: a late contribution that cannot itself repair
   * the flag the old row shape could not carry, so `containsAi` can only come
   * back true by way of the rebuild.
   */
  const lateSpan = createSpanReceivedEvent({
    eventId: "e",
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId: "e".padEnd(16, "0"),
    parentSpanId: null,
    name: "post-processing",
    occurredAt: BASE_MS + 5,
  }) as TraceProcessingEvent;

  function foldOver(found: { state: TraceSummaryData; version: string }) {
    const { repo, upsert } = repoOver(found);
    const fold = new TraceSummaryFoldProjection({
      store: new TraceSummaryStore(repo),
    });
    // The real loader is bounded at the delivered event; the delivered span is
    // deliberately absent from the history so the executor's merge of the two
    // is exercised rather than assumed.
    const eventLoaderUpTo = vi.fn(async () => history);
    fold.eventLoaderUpTo = eventLoaderUpTo;
    return { fold, eventLoaderUpTo, upsert };
  }

  describe("given the row was written by this build", () => {
    describe("when a later span arrives", () => {
      /** @scenario "A trace summary written by the current build is read straight back" */
      it("folds onto the committed state without reading the event log", async () => {
        const { fold, eventLoaderUpTo } = foldOver({
          state: { ...decodedOlderRow(), containsAi: true },
          version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        });

        const result = await new FoldProjectionExecutor().execute(
          fold,
          lateSpan,
          context,
        );

        expect(eventLoaderUpTo).not.toHaveBeenCalled();
        expect(result.spanCount).toBe(5);
      });
    });
  });

  describe("given the row was written by an older build", () => {
    describe("when a later span arrives", () => {
      /** @scenario "A refused trace summary is rebuilt from the event log, not restarted" */
      it("rebuilds the trace from the event log rather than folding onto the row", async () => {
        const { fold, eventLoaderUpTo } = foldOver({
          state: decodedOlderRow(),
          version: OLDER_STAMP,
        });

        const result = await new FoldProjectionExecutor().execute(
          fold,
          lateSpan,
          context,
        );

        expect(eventLoaderUpTo).toHaveBeenCalled();
        // The accumulated state survives the refusal: every span the trace ever
        // had is counted, not just the one that arrived after it.
        expect(result.spanCount).toBe(5);
        // …and the field the old row could not carry is recovered rather than
        // fabricated. Folding onto the decoded row would have kept it false for
        // the life of the trace.
        expect(result.containsAi).toBe(true);
      });

      /** @scenario "A refused trace summary is rebuilt from the event log, not restarted" */
      it("commits the rebuilt state, so the next read hits at the current stamp", async () => {
        const { fold, upsert } = foldOver({
          state: decodedOlderRow(),
          version: OLDER_STAMP,
        });

        await new FoldProjectionExecutor().execute(fold, lateSpan, context);

        expect(upsert).toHaveBeenCalledTimes(1);
        const [written] = upsert.mock.calls[0] as [TraceSummaryData];
        expect(written.spanCount).toBe(5);
        expect(written.containsAi).toBe(true);
      });
    });
  });

  describe("given the fold has no re-fold path wired", () => {
    describe("when a refused row is read back", () => {
      /** @scenario "A refused trace summary is rebuilt from the event log, not restarted" */
      it("refuses to fold from an empty state rather than commit a partial one", async () => {
        // Without the rebuild, refusing the row is strictly worse than trusting
        // it: the fold would start from init(), commit four spans' worth of
        // state as one, and stamp it at the CURRENT version — laundering the
        // loss past the very gate that rejected the row.
        const { repo, upsert } = repoOver({
          state: decodedOlderRow(),
          version: OLDER_STAMP,
        });
        const fold = new TraceSummaryFoldProjection({
          store: new TraceSummaryStore(repo),
        });

        await expect(
          new FoldProjectionExecutor().execute(fold, lateSpan, context),
        ).rejects.toThrow(/cannot decode/);

        expect(upsert).not.toHaveBeenCalled();
      });
    });
  });
});
