/**
 * Regression test proving `mapTraceSummaryToHeader` propagates the
 * best-effort "content may be incomplete" flags (ADR-022 / #5835) from
 * `TraceSummaryData` through to the `tracesV2.header` wire shape, the same
 * way `redactedByVisibilityWindow` already does.
 *
 * Structural template: tracesV2.redaction.unit.test.ts (same layer — a pure
 * mapper exported from tracesV2.ts, exercised directly with a fixture).
 */

import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { mapTraceSummaryToHeader } from "../tracesV2";

function makeSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    occurredAt: Date.now(),
    computedInput: "preview input",
    computedOutput: "preview output",
    errorMessage: null,
    spanCount: 1,
    totalDurationMs: 100,
    attributes: {},
    ...overrides,
  } as unknown as TraceSummaryData;
}

describe("mapTraceSummaryToHeader", () => {
  describe("given a summary whose offloaded input/output eventref could not be resolved (#5835)", () => {
    describe("when mapped to a trace header", () => {
      it("propagates inputTruncated and outputTruncated so the drawer can warn content may be incomplete", () => {
        const header = mapTraceSummaryToHeader(
          makeSummary({ inputTruncated: true, outputTruncated: true }),
        );

        expect(header.inputTruncated).toBe(true);
        expect(header.outputTruncated).toBe(true);
      });
    });
  });
});
