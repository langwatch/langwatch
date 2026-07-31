/**
 * @vitest-environment node
 *
 * Pins the trace-level model metadata stamp. The view derivation stamps
 * `metadata.model` (primary = most recently used model) and `metadata.models`
 * (the full set, most-recent-first) from the fold's model ranking.
 * Regression (#6263): without the stamp, `trace.metadata.model` was null
 * unless the user supplied it.
 *
 * A user-provided `metadata.model` must keep winning over the stamp, in any
 * delivery order and across a read-back.
 */
import { describe, expect, it } from "vitest";
import { mapAttributesToMetadata } from "~/server/traces/mappers/trace-summary.mapper";
import type { CanonicalSpan } from "../schema";
import { MODEL_METADATA_STAMPED_MARKER } from "../spanDerivation";
import {
  handleSpanReceived as analyticsHandleSpanReceived,
  deriveTraceAnalyticsView,
  initTraceAnalyticsState,
} from "../traceAnalytics.projection";
import {
  deriveTraceSummaryView,
  handleSpanReceived,
  initTraceSummaryState,
  TRACE_SUMMARY_STATE_VERSION,
  traceSummaryRowMapping,
} from "../traceSummary.projection";
import { canonicalSpan, TRACE_ID } from "./fixtures";

const ROW_CONTEXT = {
  tenantId: "tenant-1",
  key: TRACE_ID,
  version: TRACE_SUMMARY_STATE_VERSION,
  writtenAt: new Date("2026-07-30T10:00:00.000Z"),
  retentionDays: 308,
};

function llmSpan(
  spanId: string,
  model: string,
  startTimeUnixMs: number,
  attributes: Record<string, string> = {},
): CanonicalSpan {
  return canonicalSpan({
    spanId,
    model,
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 100,
    attributes,
  });
}

describe("when a multi-model trace folds spans on three models", () => {
  it("stamps metadata.model with the primary and metadata.models with the full set", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(state, llmSpan("s1", "claude-opus-5", 1_000));
    state = handleSpanReceived(
      state,
      llmSpan("s2", "claude-sonnet-4-5", 2_000),
    );
    // The [1m] context-window suffix survives ingestion and stays distinct.
    state = handleSpanReceived(
      state,
      llmSpan("s3", "claude-opus-5[1m]", 3_000),
    );

    const view = deriveTraceSummaryView(state);
    // Primary = most recently used model = models[0].
    expect(view.attributes["metadata.model"]).toBe("claude-opus-5[1m]");
    expect(JSON.parse(view.attributes["metadata.models"]!)).toEqual([
      "claude-opus-5[1m]",
      "claude-sonnet-4-5",
      "claude-opus-5",
    ]);
  });

  it("keeps the stamp in sync as later spans introduce new models", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(state, llmSpan("s1", "claude-opus-5", 1_000));
    expect(deriveTraceSummaryView(state).attributes["metadata.model"]).toBe(
      "claude-opus-5",
    );

    state = handleSpanReceived(state, llmSpan("s2", "claude-haiku-4-5", 2_000));
    const view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBe("claude-haiku-4-5");
    expect(JSON.parse(view.attributes["metadata.models"]!)).toEqual([
      "claude-haiku-4-5",
      "claude-opus-5",
    ]);
  });
});

describe("when the user provides metadata.model on any span", () => {
  it("does not clobber the user's value", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(
      state,
      llmSpan("s1", "claude-opus-5", 1_000, {
        "metadata.model": "my-custom-router",
      }),
    );
    expect(deriveTraceSummaryView(state).attributes["metadata.model"]).toBe(
      "my-custom-router",
    );

    // A later span without user metadata still must not overwrite it.
    state = handleSpanReceived(
      state,
      llmSpan("s2", "claude-sonnet-4-5", 2_000),
    );
    const view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBe("my-custom-router");
    expect(view.attributes["metadata.models"]).toBeUndefined();
    expect(view.attributes[MODEL_METADATA_STAMPED_MARKER]).toBeUndefined();
  });

  it("lets a user value that folds after a stamped write win, and stops stamping", () => {
    // First write: no user metadata, so the view stamps and the row stores it.
    let state = initTraceSummaryState();
    state = handleSpanReceived(state, llmSpan("s1", "claude-opus-5", 1_000));
    const row = traceSummaryRowMapping.toRow(state, ROW_CONTEXT);

    // Read back, then fold a span that carries user metadata.model. The strip
    // removes our stamp from state, so the user's value takes the key.
    state = traceSummaryRowMapping.fromRow(row);
    state = handleSpanReceived(
      state,
      llmSpan("s2", "claude-sonnet-4-5", 2_000, {
        "metadata.model": "my-custom-router",
      }),
    );
    let view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBe("my-custom-router");
    expect(view.attributes[MODEL_METADATA_STAMPED_MARKER]).toBeUndefined();

    // A third span without user metadata must not resume stamping.
    state = handleSpanReceived(state, llmSpan("s3", "claude-haiku-4-5", 3_000));
    view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBe("my-custom-router");
  });
});

describe("when a stamped row round-trips through the read-back", () => {
  it("re-derives the stamp instead of freezing the stored one", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(state, llmSpan("s1", "claude-opus-5", 1_000));
    const row = traceSummaryRowMapping.toRow(state, ROW_CONTEXT);
    const stored = JSON.parse(row.AttributesJson) as Record<string, string>;
    expect(stored["metadata.model"]).toBe("claude-opus-5");
    expect(stored[MODEL_METADATA_STAMPED_MARKER]).toBe("true");

    // The strip keeps the stamp out of state. A newer model then becomes the
    // primary; a frozen stamp would keep the old one.
    state = traceSummaryRowMapping.fromRow(row);
    state = handleSpanReceived(
      state,
      llmSpan("s2", "claude-sonnet-4-5", 2_000),
    );
    const view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBe("claude-sonnet-4-5");
    expect(JSON.parse(view.attributes["metadata.models"]!)).toEqual([
      "claude-sonnet-4-5",
      "claude-opus-5",
    ]);
  });
});

describe("when the trace has no model on any span", () => {
  it("stamps nothing", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(
      state,
      canonicalSpan({ spanId: "s1", model: null }),
    );
    const view = deriveTraceSummaryView(state);
    expect(view.attributes["metadata.model"]).toBeUndefined();
    expect(view.attributes["metadata.models"]).toBeUndefined();
    expect(view.attributes[MODEL_METADATA_STAMPED_MARKER]).toBeUndefined();
  });
});

describe("when folding spans into slim analytics", () => {
  it("stamps the same metadata as the trace-summary fold", () => {
    let state = initTraceAnalyticsState();
    state = analyticsHandleSpanReceived(
      state,
      llmSpan("s1", "claude-opus-5", 1_000),
    );
    state = analyticsHandleSpanReceived(
      state,
      llmSpan("s2", "claude-sonnet-4-5", 2_000),
    );
    const view = deriveTraceAnalyticsView(state);
    expect(view.attributes["metadata.model"]).toBe("claude-sonnet-4-5");
    expect(JSON.parse(view.attributes["metadata.models"]!)).toEqual([
      "claude-sonnet-4-5",
      "claude-opus-5",
    ]);
  });
});

describe("when mapping folded attributes to read-side metadata", () => {
  it("surfaces model as a string and models as an array, hiding the stamp marker", () => {
    let state = initTraceSummaryState();
    state = handleSpanReceived(state, llmSpan("s1", "claude-opus-5", 1_000));
    state = handleSpanReceived(
      state,
      llmSpan("s2", "claude-opus-5[1m]", 2_000),
    );

    const view = deriveTraceSummaryView(state);
    const metadata = mapAttributesToMetadata(view.attributes, null, null);
    expect(metadata.model).toBe("claude-opus-5[1m]");
    expect(metadata.models).toEqual(["claude-opus-5[1m]", "claude-opus-5"]);
    expect(metadata[MODEL_METADATA_STAMPED_MARKER]).toBeUndefined();
  });
});
