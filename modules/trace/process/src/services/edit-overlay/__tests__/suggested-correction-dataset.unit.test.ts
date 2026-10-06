/**
 * @vitest-environment node
 * A span output corrected through a comment's suggestion, read by the dataset mapping.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { mapTraceToDatasetEntry } from "@langwatch/dataset-contract";
import { Temporal } from "@langwatch/time";
import {
  applyOverlayToTrace,
  type Trace,
  type TraceEditOverlayPatch,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TraceEditOverlayRow } from "../../../repositories/trace-edit-overlay.repository.ts";
import { TraceEditOverlayService } from "../../trace-edit-overlay.service.ts";

const SPAN_ID = "span-search";

const capturedTrace: Trace = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
  input: { value: "what is the capital of the Netherlands?" },
  output: { value: "Rotterdam" },
  spans: [
    {
      span_id: SPAN_ID,
      trace_id: "trace-1",
      type: "tool",
      name: "web_search",
      timestamps: { started_at: 1_000, finished_at: 2_000 },
      input: { type: "text", value: "capital of the Netherlands" },
      output: { type: "text", value: "Rotterdam" },
    },
  ],
};

/** The service over a repository that keeps what it is given, as the store would. */
function serviceKeepingPatch() {
  let kept: TraceEditOverlayPatch | null = null;
  const row = (patch: TraceEditOverlayPatch) =>
    ({
      id: "traceedit_1",
      projectId: "project-1",
      traceId: "trace-1",
      patch,
      createdById: "user-1",
      updatedById: "user-1",
      createdAt: Temporal.Instant.from("2026-08-04T00:00:00.000Z"),
      updatedAt: Temporal.Instant.from("2026-08-04T00:00:00.000Z"),
      createdBy: { id: "user-1", name: "Reviewer", image: null },
      updatedBy: { id: "user-1", name: "Reviewer", image: null },
    }) as TraceEditOverlayRow;
  const service = TraceEditOverlayService.create({
    findByProjectAndTrace: async () => (kept ? row(kept) : null),
    findAllByProjectAndTraces: async () => (kept ? [row(kept)] : []),
    upsert: async ({ patch }: { patch: TraceEditOverlayPatch }) => {
      kept = patch;
      return row(patch);
    },
    delete: async () => undefined,
  } as never);
  return { service, stored: () => kept };
}

describe("given a span output corrected through a comment's suggestion", () => {
  describe("when the trace is mapped into a dataset row", () => {
    /** @scenario "A field suggested through a comment reaches the dataset" */
    it("carries the suggested output rather than the captured one", async () => {
      const { service, stored } = serviceKeepingPatch();
      await service.mergeSpanFieldEdit({
        projectId: "project-1",
        traceId: "trace-1",
        spanId: SPAN_ID,
        field: "output",
        text: "Amsterdam",
        userId: "user-1",
      });
      const patch = stored();
      if (patch === null) throw new Error("the suggestion stored no correction");

      const [row] = mapTraceToDatasetEntry({
        trace: applyOverlayToTrace({ trace: capturedTrace, patch }) as never,
        mapping: { answer: { source: "spans", key: "web_search", subkey: "output" } },
        expansions: new Set() as never,
      });

      expect(JSON.parse(String(row?.answer))).toEqual([{ type: "text", value: "Amsterdam" }]);
      expect(capturedTrace.spans[0]?.output).toEqual({ type: "text", value: "Rotterdam" });
    });
  });
});
