import { describe, expect, it, vi } from "vitest";

import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  InvalidMappingRuleError,
  type MappingRule,
} from "../normalisation-preview.rules";
import {
  diffAttributes,
  NormalisationPreviewService,
  type StoredSpansReader,
} from "../normalisation-preview.service";
import type {
  EventExplorerRepository,
  RawEventRow,
} from "../repositories/event-explorer.repository";

const TENANT_ID = "project-test-1";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "146d016273244006";

/** Minimal valid OTLP span-received event payload. */
const spanReceivedPayload = (attributes: Array<{ key: string; value: unknown }>) => ({
  span: {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "generate_content",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
  },
  resource: null,
  instrumentationScope: { name: "test-scope", version: "1.2.3" },
  piiRedactionLevel: "DISABLED",
});

const spanEventRow = (payload: unknown, eventId = "ev-1"): RawEventRow => ({
  eventId,
  eventType: SPAN_RECEIVED_EVENT_TYPE,
  eventTimestamp: "1700000000000",
  payload: JSON.stringify(payload),
});

function makeRepo(rows: RawEventRow[]): EventExplorerRepository {
  return {
    findAggregates: vi.fn().mockResolvedValue([]),
    searchAggregates: vi.fn().mockResolvedValue([]),
    findEventsByAggregate: vi.fn().mockResolvedValue(rows),
  };
}

function makeStoredSpans(spans: NormalizedSpan[]): StoredSpansReader {
  return {
    getNormalizedSpansByTraceId: vi.fn().mockResolvedValue(spans),
  };
}

describe("NormalisationPreviewService", () => {
  describe("given an aggregate with a stored span-received event", () => {
    it("replays the span through the current canonicalisation code", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            {
              key: "gen_ai.request.model",
              value: { stringValue: "gpt-5-mini" },
            },
            {
              key: "gen_ai.usage.input_tokens",
              value: { intValue: 42 },
            },
          ]),
        ),
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      expect(result.spanEventsFound).toBe(1);
      expect(result.spans).toHaveLength(1);
      const span = result.spans[0]!;
      expect(span.spanId).toBe(SPAN_ID);
      expect(span.replayedAttributes["gen_ai.request.model"]).toBe(
        "gpt-5-mini",
      );
      expect(span.appliedRules.length).toBeGreaterThan(0);
      expect(span.storedDiff).toBeNull();
      expect(span.rulesDiff).toBeNull();
    });

    it("ignores non-span events and counts unparseable span events", async () => {
      const repo = makeRepo([
        {
          eventId: "ev-other",
          eventType: "lw.obs.trace.topic_assigned",
          eventTimestamp: "1700000000000",
          payload: "{}",
        },
        spanEventRow({ nonsense: true }, "ev-bad"),
        spanEventRow("not-json-at-all}{", "ev-worse"),
        spanEventRow(
          spanReceivedPayload([
            { key: "gen_ai.request.model", value: { stringValue: "m" } },
          ]),
          "ev-good",
        ),
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      expect(result.eventsScanned).toBe(4);
      expect(result.spanEventsFound).toBe(3);
      expect(result.skippedInvalidEvents).toBe(2);
      expect(result.spans).toHaveLength(1);
    });
  });

  describe("given stored spans are available", () => {
    it("reports the drift between stored and replayed attributes", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            {
              key: "gen_ai.request.model",
              value: { stringValue: "gpt-5-mini" },
            },
          ]),
        ),
      ]);
      const stored = makeStoredSpans([
        {
          spanId: SPAN_ID,
          spanAttributes: {
            // Older build stored a different model value and an extra key
            "gen_ai.request.model": "old-model",
            "legacy.key": "still here",
          },
        } as unknown as NormalizedSpan,
      ]);
      const service = new NormalisationPreviewService(repo, stored);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      const diff = result.spans[0]!.storedDiff!;
      expect(diff).toContainEqual({
        key: "gen_ai.request.model",
        kind: "changed",
        before: "old-model",
        after: "gpt-5-mini",
      });
      expect(diff.map((d) => d.key)).toContain("legacy.key");
    });

    it("continues without a diff when the stored-span fetch fails", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            { key: "gen_ai.request.model", value: { stringValue: "m" } },
          ]),
        ),
      ]);
      const stored: StoredSpansReader = {
        getNormalizedSpansByTraceId: vi
          .fn()
          .mockRejectedValue(new Error("clickhouse down")),
      };
      const service = new NormalisationPreviewService(repo, stored);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0]!.storedDiff).toBeNull();
    });
  });

  describe("given experimental mapping rules", () => {
    const vendorRule: MappingRule = {
      match: {
        key: "vendor.payload",
        keyIsRegex: false,
        valuePattern: '"city":"([^"]+)"',
      },
      action: { type: "copy", targetKey: "langwatch.input" },
    };

    it("applies rules on top of the replayed attributes and reports the diff", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            {
              key: "vendor.payload",
              value: { stringValue: '{"city":"Amsterdam"}' },
            },
          ]),
        ),
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [vendorRule],
      });

      const rulesDiff = result.spans[0]!.rulesDiff!;
      expect(rulesDiff).toContainEqual({
        key: "langwatch.input",
        kind: "added",
        before: null,
        after: "Amsterdam",
      });
      expect(result.ruleStats).toEqual([
        { ruleIndex: 0, matchedSpanCount: 1 },
      ]);
    });

    it("rejects the whole run on an invalid rule regex without touching storage", async () => {
      const repo = makeRepo([]);
      const service = new NormalisationPreviewService(repo, null);

      await expect(
        service.previewAggregate({
          aggregateId: TRACE_ID,
          tenantId: TENANT_ID,
          rules: [
            {
              match: { key: "([", keyIsRegex: true },
              action: { type: "copy", targetKey: "t" },
            } as MappingRule,
          ],
        }),
      ).rejects.toThrowError(InvalidMappingRuleError);
      expect(repo.findEventsByAggregate).not.toHaveBeenCalled();
    });
  });

  describe("given an aggregate without span events", () => {
    it("reports that there is nothing to replay", async () => {
      const repo = makeRepo([
        {
          eventId: "ev-other",
          eventType: "lw.obs.trace.topic_assigned",
          eventTimestamp: "1700000000000",
          payload: "{}",
        },
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      expect(result.spans).toEqual([]);
      expect(result.spanEventsFound).toBe(0);
    });
  });
});

describe("diffAttributes", () => {
  describe("when maps are identical", () => {
    it("returns an empty diff", () => {
      expect(diffAttributes({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
    });
  });

  describe("when keys are added, removed, and changed", () => {
    it("classifies each entry", () => {
      const diff = diffAttributes(
        { removed: "gone", changed: "before" },
        { changed: "after", added: "new" },
      );

      expect(diff).toEqual([
        { key: "removed", kind: "removed", before: "gone", after: null },
        { key: "changed", kind: "changed", before: "before", after: "after" },
        { key: "added", kind: "added", before: null, after: "new" },
      ]);
    });
  });
});
