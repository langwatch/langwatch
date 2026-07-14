import { describe, expect, it, vi } from "vitest";

// A deterministic fake registry: one fold projection that tracks the last
// langwatch.input attribute it sees on span-received events.
vi.mock("~/server/event-sourcing/pipelineRegistry", () => ({
  getDejaViewProjections: () => [
    {
      projectionName: "fakeTraceSummary",
      eventTypes: ["lw.obs.trace.span_received"],
      init: () => ({ inputText: null as string | null, spanCount: 0 }),
      apply: (
        state: { inputText: string | null; spanCount: number },
        event: {
          data: { span?: { attributes?: Array<{ key: string; value: { stringValue?: string | null } }> } };
        },
      ) => {
        const attrs = event.data.span?.attributes ?? [];
        const input = attrs.find((a) => a.key === "langwatch.input");
        return {
          spanCount: state.spanCount + 1,
          inputText: input?.value?.stringValue ?? state.inputText,
        };
      },
    },
  ],
  getProjectionMetadata: () => [
    { projectionName: "fakeTraceSummary", aggregateType: "trace" },
  ],
}));

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
      kind: "map",
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
        sourceKey: "vendor.payload",
        ruleIndex: 0,
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
              kind: "map",
              match: { key: "([", keyIsRegex: true },
              action: { type: "copy", targetKey: "t" },
            } as MappingRule,
          ],
        }),
      ).rejects.toThrowError(InvalidMappingRuleError);
      expect(repo.findEventsByAggregate).not.toHaveBeenCalled();
    });
  });

  describe("given a specific event is selected", () => {
    const twoSpanRows = () => [
      spanEventRow(
        spanReceivedPayload([
          { key: "vendor.payload", value: { stringValue: '{"city":"Amsterdam"}' } },
        ]),
        "ev-1",
      ),
      spanEventRow(
        spanReceivedPayload([
          { key: "vendor.payload", value: { stringValue: '{"city":"Utrecht"}' } },
        ]),
        "ev-2",
      ),
    ];
    const cityRule: MappingRule = {
      kind: "map",
      match: {
        key: "vendor.payload",
        keyIsRegex: false,
        valuePattern: '"city":"([^"]+)"',
      },
      action: { type: "copy", targetKey: "langwatch.input" },
    };

    it("returns only that event's span", async () => {
      const repo = makeRepo(twoSpanRows());
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
        eventId: "ev-2",
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0]!.eventId).toBe("ev-2");
      expect(result.spanEventsFound).toBe(2);
    });

    it("still counts rule matches across all events", async () => {
      const repo = makeRepo(twoSpanRows());
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [cityRule],
        eventId: "ev-1",
      });

      expect(result.spans).toHaveLength(1);
      expect(result.ruleStats).toEqual([{ ruleIndex: 0, matchedSpanCount: 2 }]);
    });
  });

  describe("given rules and projections folding this aggregate", () => {
    const cityRule: MappingRule = {
      kind: "map",
      match: {
        key: "vendor.payload",
        keyIsRegex: false,
        valuePattern: '"city":"([^"]+)"',
      },
      action: { type: "copy", targetKey: "langwatch.input" },
    };

    it("reports how the rules change each projection's state", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            { key: "vendor.payload", value: { stringValue: '{"city":"Amsterdam"}' } },
          ]),
        ),
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [cityRule],
      });

      expect(result.projections).toHaveLength(1);
      const impact = result.projections[0]!;
      expect(impact.projectionName).toBe("fakeTraceSummary");
      expect(impact.aggregateType).toBe("trace");
      expect(impact.appliedEventCount).toBe(1);
      expect(impact.changes).toContainEqual({
        key: "inputText",
        kind: "changed",
        before: "null",
        after: "Amsterdam",
      });
      // spanCount folds identically on both sides — not in the diff
      expect(impact.changes.map((c) => c.key)).not.toContain("spanCount");
    });

    it("computes no projection impact when no rules are supplied", async () => {
      const repo = makeRepo([
        spanEventRow(
          spanReceivedPayload([
            { key: "gen_ai.request.model", value: { stringValue: "m" } },
          ]),
        ),
      ]);
      const service = new NormalisationPreviewService(repo, null);

      const result = await service.previewAggregate({
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        rules: [],
      });

      expect(result.projections).toEqual([]);
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
