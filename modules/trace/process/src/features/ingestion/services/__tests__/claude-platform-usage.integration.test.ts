/**
 * @vitest-environment node
 * @see specs/trace-processing/claude-platform-telemetry.feature
 *
 * OTLP/JSON exports through the door's usage claim on Redis, the record-span command, and every
 * fold that totals usage: the trace summary, the trace analytics and the per-minute rollup.
 */
import { shouldFilterCodingAgentSpan } from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import { parseOtlpTraces } from "@langwatch/otlp";
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { ATTR_KEYS } from "@langwatch/span-normalisation";
import {
  RECORD_SPAN_COMMAND_TYPE,
  type RecordSpanCommandData,
  type SpanReceivedEvent,
} from "@langwatch/trace-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CLAUDE_API_SCOPE,
  type ClaudeFixtureSpan,
  managedAgentsTurn,
  newTraceId,
  otlpJsonBody,
  REQUEST_COST_USD,
  retriedRequest,
  sdkAndApiRequest,
} from "../../../../__tests__/support/claude-platform-otlp.fixture.ts";
import { createTestRuntime } from "../../../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { EventingRecordSpanAdapter } from "../../../../eventing/record-span.commands.ts";
import { TraceAnalyticsFoldProjection } from "../../../../eventing/trace-derived.projection.ts";
import { TraceAnalyticsRollupMapProjection } from "../../../../eventing/trace-rollup.projection.ts";
import { TraceSummaryFoldProjection } from "../../../../eventing/trace-summary.projection.ts";
import { RedisTraceSpanDedupRepository } from "../../../../repositories/redis/redis.trace-span-dedup.repository.ts";
import { TraceCanonicalisationService } from "../../../derivation/services/trace-canonicalisation.service.ts";
import { TraceIngressCommand, TraceIngestionService } from "../trace-ingestion.service.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const TENANT_ID = "claude-otel-test-project";

const runtime = createTestRuntime();
const noopFoldStore = { store: async () => {}, get: async () => ({ kind: "empty" as const }) };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

/** The record-span command as the pipeline runs it, with no project policy to apply. */
class RecordingIngressCommand extends TraceIngressCommand {
  readonly events: SpanReceivedEvent[] = [];
  readonly #adapter = EventingRecordSpanAdapter.create({
    piiRedaction: { redact: async () => undefined },
    costEnrichment: { enrich: async () => undefined },
    tokenEstimation: { estimate: async () => undefined },
    contentDrop: { drop: async () => ({ droppedCount: 0, droppedCategories: [] }) },
  });

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    const events = await this.#adapter.handle({
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.span.traceId,
      type: RECORD_SPAN_COMMAND_TYPE,
      data,
    });
    this.events.push(...events);
  }
}

type Totals = { promptTokens: number; completionTokens: number; cost: number };

/** The usage totals each fold reaches over the recorded events, in arrival order. */
function totalsOf(events: SpanReceivedEvent[]): Record<string, Totals> {
  const summary = TraceSummaryFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  const analytics = TraceAnalyticsFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  const rollup = TraceAnalyticsRollupMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  });

  let summaryState = summary.init();
  let analyticsState = analytics.init();
  const rollupTotals: Totals = { promptTokens: 0, completionTokens: 0, cost: 0 };
  for (const event of events) {
    summaryState = summary.handleTraceSpanReceived(event, summaryState);
    analyticsState = analytics.handleTraceSpanReceived(event, analyticsState);
    const row = rollup.mapTraceSpanReceived(event);
    if (row) {
      rollupTotals.promptTokens += row.promptTokensSum;
      rollupTotals.completionTokens += row.completionTokensSum;
      rollupTotals.cost += row.costSum;
    }
  }

  return {
    traceSummary: {
      promptTokens: summaryState.totalPromptTokenCount ?? 0,
      completionTokens: summaryState.totalCompletionTokenCount ?? 0,
      cost: round(summaryState.totalCost ?? 0),
    },
    traceAnalytics: {
      promptTokens: analyticsState.totalPromptTokenCount ?? 0,
      completionTokens: analyticsState.totalCompletionTokenCount ?? 0,
      cost: round(analyticsState.totalCost ?? 0),
    },
    analyticsRollup: { ...rollupTotals, cost: round(rollupTotals.cost) },
  };
}

function round(cost: number): number {
  return Math.round(cost * 1e9) / 1e9;
}

function everyFold(totals: Totals): Record<string, Totals> {
  return { traceSummary: totals, traceAnalytics: totals, analyticsRollup: totals };
}

function attributeOf(event: SpanReceivedEvent, key: string): unknown {
  const value = event.data.span.attributes.find((attribute) => attribute.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? undefined;
}

function isMarkedCountedElsewhere(event: SpanReceivedEvent): boolean {
  return attributeOf(event, ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION) === "true";
}

function eventOf(events: SpanReceivedEvent[], span: ClaudeFixtureSpan): SpanReceivedEvent {
  const event = events.find((candidate) => candidate.data.span.spanId === span.spanId);
  if (!event) throw new Error(`no event recorded for span ${span.name}`);
  return event;
}

describe.skipIf(!redisUrl)("Claude SDK and Claude API usage, counted once per request", () => {
  let redis: RedisConnection;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    await redis?.quit();
  });

  /** One ingestion door per exporter's connection; all of them share the Redis claims. */
  function door() {
    const commands = new RecordingIngressCommand();
    const service = TraceIngestionService.create({
      codingAgentFilter: { shouldFilterSpan: shouldFilterCodingAgentSpan },
      codingAgentSpanFilterEnabled: false,
      dedup: RedisTraceSpanDedupRepository.create({ connection: redis }),
      commands,
    });
    const send = async (traceId: string, spans: ClaudeFixtureSpan[]) => {
      const parsed = parseOtlpTraces(otlpJsonBody({ traceId, spans }), "application/json");
      if (!parsed.ok) throw new Error(parsed.error);
      const result = await service.handleOtlpTraceRequest(TENANT_ID, parsed.request, "DISABLED");
      expect(result.rejectedSpans).toBe(0);
    };
    return { events: commands.events, send };
  }

  const ONE_REQUEST: Totals = { promptTokens: 1200, completionTokens: 85, cost: REQUEST_COST_USD };

  describe("given a request traced by the SDK and the API", () => {
    describe("when the SDK spans arrive before the API spans", () => {
      /** @scenario "A request traced by the SDK and the API counts its usage once" */
      it("totals the request once on every fold, and every span keeps its usage", async () => {
        const traceId = newTraceId();
        const { sdk, api } = sdkAndApiRequest();
        const { events, send } = door();

        await send(traceId, sdk);
        await send(traceId, api);

        expect(totalsOf(events)).toEqual(everyFold(ONE_REQUEST));
        expect(events).toHaveLength(sdk.length + api.length);
        const apiCreate = eventOf(events, api[0]!);
        expect(isMarkedCountedElsewhere(apiCreate)).toBe(true);
        expect(attributeOf(apiCreate, "gen_ai.usage.input_tokens")).toBe(1200);
        expect(isMarkedCountedElsewhere(eventOf(events, sdk[0]!))).toBe(false);
      });
    });

    describe("when the API spans arrive before the SDK span", () => {
      /** @scenario "The usage counts once whichever source arrives first" */
      it("totals the request once and marks the SDK span", async () => {
        const traceId = newTraceId();
        const { sdk, api } = sdkAndApiRequest();
        const { events, send } = door();

        await send(traceId, api);
        await send(traceId, sdk);

        expect(totalsOf(events)).toEqual(everyFold(ONE_REQUEST));
        expect(isMarkedCountedElsewhere(eventOf(events, sdk[0]!))).toBe(true);
        expect(isMarkedCountedElsewhere(eventOf(events, api[0]!))).toBe(false);
      });
    });

    describe("when the API sends the same spans again", () => {
      /** @scenario "A resent API export does not count the request again" */
      it("still totals the request once", async () => {
        const traceId = newTraceId();
        const { sdk, api } = sdkAndApiRequest();
        const sdkDoor = door();
        const apiDoor = door();

        await sdkDoor.send(traceId, sdk);
        await apiDoor.send(traceId, api);
        await apiDoor.send(traceId, api);

        expect(totalsOf([...sdkDoor.events, ...apiDoor.events])).toEqual(everyFold(ONE_REQUEST));
      });
    });
  });

  describe("given an API span sent without the SDK's trace context", () => {
    /** @scenario "An API span sent without the SDK's trace context still counts the request once" */
    it("counts the request once across the two traces", async () => {
      const sdkTraceId = newTraceId();
      const apiTraceId = newTraceId();
      const { sdk, api } = sdkAndApiRequest();
      const apiRoot = api.map((span, index) =>
        index === 0 ? { ...span, parentSpanId: null } : span,
      );
      const { events, send } = door();

      await send(sdkTraceId, sdk);
      await send(apiTraceId, apiRoot);

      const ofTrace = (traceId: string) =>
        events.filter((event) => event.data.span.traceId === traceId);
      expect(totalsOf(ofTrace(sdkTraceId))).toEqual(everyFold(ONE_REQUEST));
      expect(totalsOf(ofTrace(apiTraceId))).toEqual(
        everyFold({ promptTokens: 0, completionTokens: 0, cost: 0 }),
      );
    });
  });

  describe("given a request traced only by the SDK", () => {
    /** @scenario "A request traced only by the SDK counts its messages.create span" */
    it("counts the SDK messages.create span", async () => {
      const traceId = newTraceId();
      const { sdk } = sdkAndApiRequest();
      const { events, send } = door();

      await send(traceId, sdk);

      expect(totalsOf(events)).toEqual(everyFold(ONE_REQUEST));
    });
  });

  describe("given a request traced only by the API", () => {
    /** @scenario "A request traced only by the API counts its messages.create span, not its model requests" */
    it("counts the messages.create span and none of its model requests", async () => {
      const traceId = newTraceId();
      const { api } = sdkAndApiRequest();
      const { events, send } = door();

      await send(traceId, api);

      expect(totalsOf(events)).toEqual(everyFold(ONE_REQUEST));
    });
  });

  describe("given a request the SDK retried, which the API traced per attempt", () => {
    /** @scenario "Each attempt of a request the SDK retried counts once" */
    it("counts each attempt once", async () => {
      const traceId = newTraceId();
      const { spans, firstAttempt, secondAttempt } = retriedRequest();
      const { events, send } = door();

      await send(
        traceId,
        spans.filter((span) => span.scope !== CLAUDE_API_SCOPE),
      );
      await send(
        traceId,
        spans.filter((span) => span.scope === CLAUDE_API_SCOPE),
      );

      expect(totalsOf(events)).toEqual(
        everyFold({
          promptTokens: firstAttempt.input + secondAttempt.input,
          completionTokens: firstAttempt.output + secondAttempt.output,
          cost: round(
            (firstAttempt.input + secondAttempt.input) * 5e-6 +
              (firstAttempt.output + secondAttempt.output) * 2.5e-5,
          ),
        }),
      );
    });
  });

  describe("given a Managed Agents session turn", () => {
    /** @scenario "A Managed Agents session counts its model requests and outcome evaluations" */
    it("totals its model requests and outcome evaluation, and nothing for the turn", async () => {
      const traceId = newTraceId();
      const { events, send } = door();

      await send(traceId, managedAgentsTurn());

      // The outcome evaluation names no model, so its tokens count without a price.
      expect(totalsOf(events)).toEqual(
        everyFold({
          promptTokens: 900 + 600 + 300,
          completionTokens: 40 + 30 + 20,
          cost: round((900 + 600) * 5e-6 + (40 + 30) * 2.5e-5),
        }),
      );
    });
  });
});
