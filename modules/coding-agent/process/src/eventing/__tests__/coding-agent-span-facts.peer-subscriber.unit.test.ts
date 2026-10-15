import type { ContributeSpanFactsCommandData } from "@langwatch/coding-agent-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  type CanonicalizeSpanAttributesInput,
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEventData,
  type TraceApi,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  buildTestCodingAgentProcessingPipeline,
  inertReceivedFacts,
} from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import type { CodingAgentCommandDispatcherService } from "../../services/coding-agent-command-dispatcher.service.ts";
import { CodingAgentReceivedFactsService } from "../../services/coding-agent-received-facts.service.ts";

const SPAN_LANE = "coding_agent_processing.codingAgentSpanFactsDispatch";
const MODEL = "claude-sonnet-4-5";

function spanData({
  name,
  scopeName,
  spanId = "span-1",
}: {
  name: string;
  scopeName: string;
  spanId?: string;
}): SpanReceivedEventData {
  return {
    span: {
      traceId: "trace-1",
      spanId,
      parentSpanId: null,
      name,
      kind: 1,
      startTimeUnixNano: "1700000000000000000",
      endTimeUnixNano: "1700000001000000000",
      attributes: [
        { key: "model", value: { stringValue: MODEL } },
        { key: "session.id", value: { stringValue: "sess-1" } },
      ],
      events: [],
      links: [],
      status: { code: null, message: null },
      flags: null,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: { name: scopeName, version: null },
    piiRedactionLevel: "STRICT",
  };
}

const claudeModelCall = () =>
  spanData({ name: "claude_code.llm_request", scopeName: "com.anthropic.claude_code" });
const foreign = () => spanData({ name: "http.request", scopeName: "com.acme.pipeline" });

function spanEvent({ data, id = "event-1" }: { data: SpanReceivedEventData; id?: string }): Event {
  return {
    id,
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data,
  };
}

/** Stands in for trace's canonicaliser: lifts Claude Code's bare `model` as trace does. */
function canonicalisingTraces(asked: CanonicalizeSpanAttributesInput[]): TraceApi {
  return createApiFixture<TraceApi>({
    canonicalizeSpanAttributes: (input) => {
      asked.push(input);
      const model = input.spanAttributes.model;
      return {
        attributes: { ...input.spanAttributes, "gen_ai.request.model": model },
        events: input.events,
        appliedRules: ["claude-code"],
      };
    },
  });
}

/** The span lane the real pipeline registers, over the real received-facts service. */
function spanLane({
  traces = createApiFixture<TraceApi>(),
  contributed = [],
}: {
  traces?: TraceApi;
  contributed?: ContributeSpanFactsCommandData[];
} = {}): EventSubscriberDefinition {
  const receivedFacts = CodingAgentReceivedFactsService.create({
    traces,
    commands: createApiFixture<CodingAgentCommandDispatcherService>({
      contributeSpanFacts: async (data) => void contributed.push(data),
    }),
  });
  const pipeline = buildTestCodingAgentProcessingPipeline(undefined, {
    ...inertReceivedFacts,
    contributeReceivedSpan: (input) => receivedFacts.contributeReceivedSpan(input),
  });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const found = lanes.get(SPAN_LANE);
  if (found === undefined) throw new Error(`no peer lane registered as ${SPAN_LANE}`);
  return found;
}

function deduplicationIdOf({
  definition,
  event,
}: {
  definition: EventSubscriberDefinition;
  event: Event;
}): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the span lane declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const context = { tenantId: createTenantId("tenant-1"), aggregateId: "trace-1" };

describe("coding-agent's peer subscriber on trace's span-received fact", () => {
  describe("when a Claude Code model call's span is received", () => {
    /** @scenario "A received coding-agent span becomes session facts through coding-agent's own peer subscriber" */
    it("decodes it, canonicalises through trace's API and contributes the model it named", async () => {
      const asked: CanonicalizeSpanAttributesInput[] = [];
      const contributed: ContributeSpanFactsCommandData[] = [];
      const definition = spanLane({ traces: canonicalisingTraces(asked), contributed });

      expect(definition.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      await definition.handle(spanEvent({ data: claudeModelCall() }), context);

      expect(asked).toHaveLength(1);
      expect(asked[0]?.spanAttributes.model).toBe(MODEL);
      expect(contributed).toHaveLength(1);
      expect(contributed[0]).toMatchObject({
        tenantId: "tenant-1",
        traceId: "trace-1",
        spanId: "span-1",
        name: "claude_code.llm_request",
        occurredAt: 1_700_000_000_000,
      });
      expect(contributed[0]?.facts["gen_ai.request.model"]).toBe(MODEL);
    });
  });

  describe("when the enqueue filter reads a span", () => {
    /** @scenario "A span no coding agent claims mints no coding-agent job" */
    it("admits a coding-agent span and declines one no coding agent claims", () => {
      const filter = spanLane().options?.enqueue?.filter;

      expect(filter?.(spanEvent({ data: claudeModelCall() }))).toBe(true);
      expect(filter?.(spanEvent({ data: foreign() }))).toBe(false);
    });
  });

  describe("given the same span-received fact is delivered twice", () => {
    /** @scenario "A redelivered span resolves to the coding-agent job already queued" */
    it("keys both deliveries to one job per tenant, trace and span", () => {
      const definition = spanLane();
      const first = deduplicationIdOf({
        definition,
        event: spanEvent({ data: claudeModelCall() }),
      });

      expect(first).toBe("coding-agent-span-facts:tenant-1:trace-1:span-1");
      expect(
        deduplicationIdOf({
          definition,
          event: spanEvent({ data: claudeModelCall(), id: "redelivered" }),
        }),
      ).toBe(first);
      expect(
        deduplicationIdOf({
          definition,
          event: spanEvent({
            data: spanData({
              name: "claude_code.llm_request",
              scopeName: "com.anthropic.claude_code",
              spanId: "span-2",
            }),
          }),
        }),
      ).not.toBe(first);
    });
  });

  describe("when the span it is handed cannot be canonicalised", () => {
    /** @scenario "A span that cannot be decoded or canonicalised completes without contributing facts" */
    it("completes quietly and contributes nothing", async () => {
      const contributed: ContributeSpanFactsCommandData[] = [];
      const definition = spanLane({ traces: createApiFixture<TraceApi>(), contributed });

      await expect(
        definition.handle(spanEvent({ data: claudeModelCall() }), context),
      ).resolves.toBeUndefined();
      expect(contributed).toEqual([]);
    });
  });

  describe("when eventing's enqueue staging reads the span lane", () => {
    /** @scenario a matching event mints a job for the subscriber */
    it("mints a job for a span its filter admits", () => {
      expect(spanLane().options?.enqueue?.filter?.(spanEvent({ data: claudeModelCall() }))).toBe(
        true,
      );
    });

    /** @scenario a redelivered event resolves to the unit of work already queued */
    it("resolves a redelivery to the job already queued", () => {
      const definition = spanLane();
      expect(
        deduplicationIdOf({
          definition,
          event: spanEvent({ data: claudeModelCall(), id: "redelivered" }),
        }),
      ).toBe(deduplicationIdOf({ definition, event: spanEvent({ data: claudeModelCall() }) }));
    });

    /** @scenario an event the subscriber declines is still completed quietly */
    it("completes a span it declines to contribute without throwing", async () => {
      const contributed: ContributeSpanFactsCommandData[] = [];
      const definition = spanLane({ traces: createApiFixture<TraceApi>(), contributed });
      await expect(
        definition.handle(spanEvent({ data: claudeModelCall() }), context),
      ).resolves.toBeUndefined();
      expect(contributed).toEqual([]);
    });
  });
});
