/**
 * @vitest-environment node
 *
 * What a corrected trace becomes once it is mapped into a dataset row. This is
 * the point of the whole feature and it is deliberate: a dataset holds the
 * trace as it should have been, so a corrected output is the output the dataset
 * gets, whether the correction came from the drawer or from a suggested
 * expected output. The captured trace is untouched and still identifies the row.
 */
import { describe, expect, it } from "vitest";
import {
  extractTracesFields,
  mapTraceToDatasetEntry,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "@langwatch/trace-contract";
import { applyOverlayToTrace } from "../applyTraceEditOverlay";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";

const capturedTrace = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
  input: { value: "what is the capital of the Netherlands?" },
  output: { value: "Rotterdam" },
  spans: [],
} as unknown as Trace;

const correctedOutputPatch: TraceEditOverlayPatch = {
  version: 1,
  trace: { output: { value: "Amsterdam" } },
  spans: [],
  deletedSpanIds: [],
};

describe("mapping a corrected trace into a dataset", () => {
  describe("given a trace whose output was corrected", () => {
    /** @scenario "A dataset output column carries the corrected output" */
    it("fills the output column with the correction and keeps the captured trace id", () => {
      const corrected = applyOverlayToTrace({
        trace: capturedTrace,
        patch: correctedOutputPatch,
      });

      const [row] = mapTraceToDatasetEntry(
        corrected as never,
        {
          trace_id: { source: "trace_id" },
          input: { source: "input" },
          output: { source: "output" },
        },
        new Set(),
      );

      expect(row).toEqual({
        trace_id: "trace-1",
        input: "what is the capital of the Netherlands?",
        output: "Amsterdam",
      });
      expect(capturedTrace.output?.value).toBe("Rotterdam");
    });

    it("carries the correction through the thread field extraction too", () => {
      const corrected = applyOverlayToTrace({
        trace: capturedTrace,
        patch: correctedOutputPatch,
      });

      expect(extractTracesFields([corrected as never], ["output"])).toEqual([
        { output: "Amsterdam" },
      ]);
    });
  });

  describe("given a trace whose metadata was corrected", () => {
    const capturedMetadataTrace = {
      ...capturedTrace,
      metadata: { environment: "staging", reviewer: "unassigned" },
    } as unknown as Trace;

    /** @scenario "Corrected metadata reaches the dataset mapping" */
    it("fills the metadata column with the correction", () => {
      const corrected = applyOverlayToTrace({
        trace: capturedMetadataTrace,
        patch: {
          version: 1,
          trace: { metadata: { environment: "production", reviewer: null } },
          spans: [],
          deletedSpanIds: [],
        },
      });

      const [row] = mapTraceToDatasetEntry(
        corrected as never,
        {
          environment: { source: "metadata", key: "environment" },
          reviewer: { source: "metadata", key: "reviewer" },
        },
        new Set(),
      );

      expect(row).toEqual({ environment: "production", reviewer: undefined });
      expect(capturedMetadataTrace.metadata.environment).toBe("staging");
    });
  });
});
