import type { TraceEditOverlayPatch, TraceHeader } from "@langwatch/trace-contract";
/**
 * Applying a correction to the drawer header: span count, and metadata
 * attributes read from the header row the way they were ingested.
 */
import { describe, expect, it } from "vitest";

import {
  applyOverlayToTraceHeader,
  changedTraceMetadataKeys,
} from "../apply-trace-edit-overlay-to-views.ts";

const patchOf = (overrides: Partial<TraceEditOverlayPatch>): TraceEditOverlayPatch => ({
  version: 1,
  spans: [],
  deletedSpanIds: [],
  ...overrides,
});

const headerWith = (attributes: TraceHeader["attributes"]): TraceHeader => ({
  traceId: "trace-1",
  name: "trace",
  conversationId: null,
  input: null,
  output: null,
  timestamp: 1_000,
  serviceName: "svc",
  origin: "application",
  userId: null,
  durationMs: 1,
  models: [],
  totalCost: null,
  nonBilledCost: 0,
  totalTokens: 0,
  inputTokens: null,
  outputTokens: null,
  tokensEstimated: false,
  traceName: "trace",
  rootSpanType: null,
  scenarioRunId: null,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  status: "ok",
  spanCount: 1,
  attributes,
});

describe("applying a correction to the drawer header", () => {
  describe("given a correction that deletes spans", () => {
    /** @scenario "The header counts the spans the corrected trace has" */
    it("counts only the spans the corrected trace still has", () => {
      const spans = [
        { spanId: "root", parentSpanId: null },
        { spanId: "tool", parentSpanId: "root" },
        { spanId: "tool-child", parentSpanId: "tool" },
      ];
      const header = {
        traceId: "trace-1",
        spanCount: 3,
      } as Parameters<typeof applyOverlayToTraceHeader>[0]["header"];

      const corrected = applyOverlayToTraceHeader({
        header,
        patch: patchOf({ deletedSpanIds: ["tool"] }),
        spans,
      });
      expect(corrected.spanCount).toBe(1);

      // The captured trace is counted as it was captured.
      expect(applyOverlayToTraceHeader({ header, patch: null, spans }).spanCount).toBe(3);

      // An id the correction lists that the trace does not have removes nothing
      // from the count.
      expect(
        applyOverlayToTraceHeader({
          header,
          patch: patchOf({ deletedSpanIds: ["never-ingested"] }),
          spans,
        }).spanCount,
      ).toBe(3);
    });
  });

  describe("given a correction that changes the trace metadata", () => {
    /** @scenario "Corrected metadata reads on the drawer header" */
    it("reads on the header row the metadata was ingested on", () => {
      const corrected = applyOverlayToTraceHeader({
        header: headerWith({
          "metadata.environment": "staging",
          "metadata.reviewer": "unassigned",
          "langwatch.labels": '["nightly"]',
        }),
        patch: patchOf({
          trace: {
            metadata: {
              environment: "production",
              reviewer: null,
              labels: ["nightly", "reviewed"],
            },
          },
        }),
      });

      expect(corrected.attributes).toEqual({
        "metadata.environment": "production",
        "langwatch.labels": '["nightly","reviewed"]',
      });
    });

    /** @scenario "Corrected metadata reads on the drawer header" */
    it("names the metadata keys the correction changed", () => {
      expect(
        changedTraceMetadataKeys(
          patchOf({
            trace: { metadata: { environment: "production", reviewer: null } },
          }),
        ),
      ).toEqual(["environment", "reviewer"]);
      expect(changedTraceMetadataKeys(patchOf({}))).toEqual([]);
      expect(changedTraceMetadataKeys(null)).toEqual([]);
    });
  });
});
