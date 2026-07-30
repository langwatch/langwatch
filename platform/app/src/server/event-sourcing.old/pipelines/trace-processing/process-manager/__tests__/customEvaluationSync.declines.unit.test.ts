/**
 * A dropped custom evaluation has to be visible.
 *
 * `handleSpanReceived` declines a span in four ways. Three are accounted for:
 * an ordinary span carries nothing (the normal case, and the enqueue filter
 * means it usually never reaches the handler), and an unreferenceable span is
 * logged at error. The stale branch was silent — no log line, no metric — and
 * it is the one that discards a verdict a customer's SDK actually computed:
 * `isStale` compares the span's BUSINESS time against handling time, so an SDK
 * that batch-exports after a long job, a clock-skewed client, or a
 * trace-processing group parked for over an hour all land on it. The platform
 * then shows an evaluation that never ran, and nothing anywhere says why.
 *
 * These tests drive the real handler and read the real Prometheus counter, plus
 * the log line the handler emits, because "the drop is observable" is the whole
 * behaviour under test — a spy on an internal call would prove nothing about
 * what an operator can actually see.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import { customEvaluationSyncDroppedCounter } from "~/server/metrics";

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: logs.warn,
    error: logs.error,
  }),
}));

import { STALE_TRACE_THRESHOLD_MS } from "../../schemas/constants";
import { handleSpanReceived } from "../customEvaluationSync.process";
import {
  type CustomEvaluationSyncEventView,
  INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
} from "../customEvaluationSyncProcess.types";

const TRACE_ID = "trace-1";
const SPAN_ID = "bbbb000000000001";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;
const SPAN_STARTED_AT = NOW - 1_000;

type Intents = Parameters<typeof handleSpanReceived>[2]["intents"];

function makeCtx(
  overrides: { at?: number; now?: number } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: TRACE_ID,
    projectId: PROJECT_ID,
    intents: {
      reportEvaluations: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "reportEvaluations",
        payload,
      }),
    } as unknown as Intents,
  };
}

function view(
  overrides: Partial<CustomEvaluationSyncEventView> = {},
): CustomEvaluationSyncEventView {
  return {
    spanId: SPAN_ID,
    spanStartedAt: SPAN_STARTED_AT,
    hasCustomEvaluations: true,
    ...overrides,
  };
}

async function droppedCount(reason: string): Promise<number> {
  const metric = await customEvaluationSyncDroppedCounter.get();
  return metric.values.find((v) => v.labels.reason === reason)?.value ?? 0;
}

/** Older than the threshold by a full minute, so the branch is unambiguous. */
const STALE_CTX = () =>
  makeCtx({ at: NOW - STALE_TRACE_THRESHOLD_MS - 60_000, now: NOW });

describe("customEvaluationSync declines", () => {
  beforeEach(() => {
    logs.warn.mockClear();
    logs.error.mockClear();
  });

  describe("given a span whose own time is older than the stale threshold", () => {
    describe("when it carried a verdict the SDK computed", () => {
      /** @scenario A custom evaluation the platform declines to record is reported */
      it("counts the drop", async () => {
        const before = await droppedCount("stale");

        handleSpanReceived(
          INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
          view(),
          STALE_CTX(),
        );

        await expect(droppedCount("stale")).resolves.toBe(before + 1);
      });

      /** @scenario A custom evaluation the platform declines to record is reported */
      it("names the trace, the span and how late it was", () => {
        handleSpanReceived(
          INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
          view(),
          STALE_CTX(),
        );

        expect(logs.warn).toHaveBeenCalledTimes(1);
        expect(logs.warn.mock.calls[0]?.[0]).toEqual({
          tenantId: PROJECT_ID,
          traceId: TRACE_ID,
          spanId: SPAN_ID,
          ageMs: STALE_TRACE_THRESHOLD_MS + 60_000,
        });
      });

      it("still asks for nothing", () => {
        const result = handleSpanReceived(
          INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
          view(),
          STALE_CTX(),
        );

        // The classification question stays open (ADR-098). Making the drop
        // visible does not change what is dropped.
        expect(result.intents ?? []).toEqual([]);
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given a span that carried a verdict it cannot be referenced by", () => {
    it("counts that drop under its own reason", async () => {
      const before = await droppedCount("unreferenceable");

      handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view({ spanId: null }),
        makeCtx(),
      );

      await expect(droppedCount("unreferenceable")).resolves.toBe(before + 1);
      expect(logs.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a span the pipeline relays normally", () => {
    it("counts no drop and says nothing", async () => {
      const staleBefore = await droppedCount("stale");
      const unreferenceableBefore = await droppedCount("unreferenceable");

      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ at: NOW - 20_000, now: NOW }),
      );

      expect(result.intents).toHaveLength(1);
      await expect(droppedCount("stale")).resolves.toBe(staleBefore);
      await expect(droppedCount("unreferenceable")).resolves.toBe(
        unreferenceableBefore,
      );
      expect(logs.warn).not.toHaveBeenCalled();
    });
  });

  describe("given an ordinary span that carried no evaluation at all", () => {
    it("counts no drop, because nothing was lost", async () => {
      const before = await droppedCount("stale");

      handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view({ hasCustomEvaluations: false }),
        STALE_CTX(),
      );

      // A stale ordinary span is not a dropped verdict, and counting it would
      // bury the signal under the whole product's span volume.
      await expect(droppedCount("stale")).resolves.toBe(before);
      expect(logs.warn).not.toHaveBeenCalled();
    });
  });
});
