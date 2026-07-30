import { describe, expect, it } from "vitest";
import { mapSpanReceived, storedSpanRecordSchema } from "../spanStorage.projection";
import { storedSpansTable } from "../table";
import { canonicalSpan } from "./fixtures";

describe("the stored-span record", () => {
  describe("given a canonicalized span", () => {
    /** @scenario "Event transformation" */
    it("carries every field the trace-level totals query reads", () => {
      const record = mapSpanReceived(
        canonicalSpan({
          spanId: "s1",
          parentSpanId: null,
          model: "gpt-5-mini",
          spanType: "llm",
          startTimeUnixMs: 1_000,
          endTimeUnixMs: 2_500,
          cost: { cost: 0.5, nonBilledCost: 0.1 },
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 3,
            cacheReadTokens: 4,
            cacheWriteTokens: 5,
            estimated: true,
          },
        }),
      );

      expect(storedSpanRecordSchema.parse(record)).toEqual(record);
      expect(record).toMatchObject({
        spanId: "s1",
        model: "gpt-5-mini",
        spanType: "llm",
        durationMs: 1_500,
        cost: 0.5,
        nonBilledCost: 0.1,
        promptTokens: 10,
        completionTokens: 20,
        reasoningTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        tokensEstimated: true,
      });
    });

    it("keeps a reported zero as zero and an unreported count as absent", () => {
      const record = mapSpanReceived(
        canonicalSpan({
          usage: {
            inputTokens: 0,
            outputTokens: null,
            reasoningTokens: 0,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimated: false,
          },
          cost: { cost: 0, nonBilledCost: null },
        }),
      );

      expect(record.promptTokens).toBe(0);
      expect(record.completionTokens).toBeNull();
      expect(record.reasoningTokens).toBe(0);
      expect(record.cost).toBe(0);
      expect(record.nonBilledCost).toBeNull();
    });

    it("uses an empty string, not null, where the column is low-cardinality", () => {
      const record = mapSpanReceived(
        canonicalSpan({
          model: null,
          spanType: null,
          piiRedactionStatus: null,
        }),
      );

      expect(record.model).toBe("");
      expect(record.spanType).toBe("");
      expect(record.piiRedactionStatus).toBe("");
    });
  });

  describe("given the same span delivered twice", () => {
    it("produces one record whose engine key is identical, so the rows collapse", () => {
      const span = canonicalSpan({ spanId: "s1" });
      const first = mapSpanReceived(span);
      const second = mapSpanReceived(span);

      expect(second).toEqual(first);
      expect(storedSpansTable.sortKey).toEqual([
        "TenantId",
        "TraceId",
        "SpanId",
      ]);
      expect(storedSpansTable.merge).toEqual({
        kind: "replacing",
        version: "WrittenAt",
      });
    });
  });
});
