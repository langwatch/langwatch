/**
 * The scoped data-privacy content DROP wired into RecordSpanCommand.
 *
 * The drop runs at this single command choke point, so the emitted
 * SpanReceivedEvent carries the already-dropped span: both the span store and
 * the trace-summary fold (driven here for real) see no dropped content. The
 * policy is supplied directly (the DB-backed resolution path has its own
 * tests in @langwatch/data-privacy-server); the real drop logic + real fold
 * run end-to-end.
 */
import { createTenantId, type Command, type TenantId } from "@langwatch/eventing";
import {
  PRIVACY_DROPPED_MARKER_ATTR,
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { OtlpSpanContentDropService } from "@langwatch/data-privacy-server";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventSchema,
  type OtlpKeyValue,
  type OtlpResource,
  type OtlpSpan,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { EventingRecordSpanAdapter } from "../../adapters/eventing.record-span.adapter";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";
import { TraceSummaryFoldProjection } from "../../projections/trace-summary.projection";
import { createTestRuntime } from "../../projections/__tests__/fixtures/trace-summary-test.fixtures";
import {
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "../trace-span-preparation.port";

function policy({
  input = "capture" as Disposition,
  output = "capture" as Disposition,
  system = "capture" as Disposition,
  tools = "capture" as Disposition,
}): ResolvedDataPrivacy {
  const cat = (disposition: Disposition) => ({
    disposition,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: {
      input: cat(input),
      output: cat(output),
      system: cat(system),
      tools: cat(tools),
    },
    pii: { level: "essential", entities: [], exceptPatterns: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
  };
}

/**
 * The real content-drop service, driven from a policy handed in directly
 * rather than resolved from a project — the resolution path has its own
 * tests, this one only needs the strip.
 */
const dropService = OtlpSpanContentDropService.create({
  dataPrivacy: {
    getResolvedForProject: async () => {
      throw new Error("unused: this fake injects the policy directly");
    },
  },
  nativePolicyEnforced: true,
});

class ContentDropWithPolicy extends TraceSpanContentDropPort {
  constructor(private readonly dropPolicy: ResolvedDataPrivacy | null) {
    super();
  }

  async drop(span: OtlpSpan, _projectId: string) {
    if (!this.dropPolicy) {
      return { droppedCount: 0, droppedCategories: [] };
    }
    return dropService.stripSpanContent({ span, policy: this.dropPolicy });
  }
}

class NoopPiiRedaction extends TraceSpanPiiRedactionPort {
  async redact(
    _span: OtlpSpan,
    _resource: OtlpResource | null,
    _level: PIIRedactionLevel,
    _tenantId: TenantId,
  ) {}
}

class NoopCostEnrichment extends TraceSpanCostEnrichmentPort {
  async enrich(_span: OtlpSpan, _tenantId: string) {}
}

class NoopTokenEstimation extends TraceSpanTokenEstimationPort {
  async estimate(_span: OtlpSpan, _tenantId: string) {}
}

function makeHandler(dropPolicy: ResolvedDataPrivacy | null): EventingRecordSpanAdapter {
  return EventingRecordSpanAdapter.create({
    piiRedaction: new NoopPiiRedaction(),
    costEnrichment: new NoopCostEnrichment(),
    tokenEstimation: new NoopTokenEstimation(),
    contentDrop: new ContentDropWithPolicy(dropPolicy),
  });
}

function kv(record: Record<string, string>): OtlpKeyValue[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

function command({
  project = "project-1",
  attributes = {},
  resourceAttributes = {},
  level = "ESSENTIAL" as PIIRedactionLevel,
}: {
  project?: string;
  attributes?: Record<string, string>;
  resourceAttributes?: Record<string, string>;
  level?: PIIRedactionLevel;
}): Command<RecordSpanCommandData> {
  const data: RecordSpanCommandData = {
    tenantId: project,
    occurredAt: 1_000_000,
    span: {
      traceId: "trace-1",
      spanId: "span-1",
      name: "test-span",
      kind: 1,
      startTimeUnixNano: "0",
      endTimeUnixNano: "1000000",
      attributes: kv(attributes),
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: { attributes: kv(resourceAttributes) },
    instrumentationScope: { name: "test-scope" },
    piiRedactionLevel: level,
  };
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: "trace-1",
    tenantId: createTenantId(project),
    data,
  };
}

function spanKeys(event: { data: { span: { attributes: OtlpKeyValue[] } } }): string[] {
  return event.data.span.attributes.map((a) => a.key);
}

const IO_ATTRS = {
  "langwatch.input": "the secret question",
  "langwatch.output": "the answer",
  "gen_ai.request.model": "gpt-5-mini",
};

describe("RecordSpanCommand content drop", () => {
  describe("given a rule that drops trace input", () => {
    describe("when the span is ingested through the OpenTelemetry endpoint", () => {
      /** @scenario Dropped input never reaches storage from the OpenTelemetry endpoint */
      it("drops input but keeps output for an OpenTelemetry-ingested span", async () => {
        const events = await makeHandler(policy({ input: "drop" })).handle(
          command({ attributes: IO_ATTRS }),
        );
        const event = spanReceivedEventSchema.parse(
          events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );

        expect(spanKeys(event)).not.toContain("langwatch.input");
        expect(spanKeys(event)).toContain("langwatch.output");
        expect(spanKeys(event)).toContain("gen_ai.request.model");
      });
    });

    describe("when the span is ingested through the REST collector", () => {
      /** @scenario Dropping applies to traces from the REST collector too */
      it("drops input for a span ingested through the REST collector", async () => {
        const events = await makeHandler(policy({ input: "drop" })).handle(
          command({
            attributes: IO_ATTRS,
            resourceAttributes: { "telemetry.sdk.name": "langwatch-rest" },
          }),
        );
        const event = spanReceivedEventSchema.parse(
          events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );

        expect(spanKeys(event)).not.toContain("langwatch.input");
      });
    });
  });

  describe("given a rule that drops input and output", () => {
    describe("when a gateway-origin span is recorded", () => {
      /** @scenario Dropping applies to gateway traffic */
      it("drops both input and output for a gateway-origin span", async () => {
        const events = await makeHandler(policy({ input: "drop", output: "drop" })).handle(
          command({
            attributes: IO_ATTRS,
            resourceAttributes: { "langwatch.origin": "gateway" },
          }),
        );
        const event = spanReceivedEventSchema.parse(
          events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );

        expect(spanKeys(event)).not.toContain("langwatch.input");
        expect(spanKeys(event)).not.toContain("langwatch.output");
        expect(spanKeys(event)).toContain(PRIVACY_DROPPED_MARKER_ATTR);
      });
    });
  });

  describe("given input is dropped and the trace summary is folded", () => {
    describe("when the fold derives the computed input and output", () => {
      /** @scenario The trace-level computed input is cleared when input is dropped */
      it("yields no computed input from the fold but keeps the computed output", async () => {
        const runtime = createTestRuntime();
        const fold = TraceSummaryFoldProjection.create({
          store: { store: async () => {}, get: async () => null },
          traceCanonicalisation: TraceCanonicalisationService.create(),
          runtime,
        });

        // Control: no drop policy — the fold derives a computed input.
        const captured = await makeHandler(null).handle(
          command({ project: "project-keep", attributes: IO_ATTRS }),
        );
        const capturedEvent = spanReceivedEventSchema.parse(
          captured.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );
        const keptState = fold.handleTraceSpanReceived(capturedEvent, fold.init());
        expect(keptState.computedInput).toBeTruthy();

        // Drop input — the same fold path now sees no input on the event.
        const dropped = await makeHandler(policy({ input: "drop" })).handle(
          command({ project: "project-drop", attributes: IO_ATTRS }),
        );
        const droppedEvent = spanReceivedEventSchema.parse(
          dropped.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );
        expect(spanKeys(droppedEvent)).not.toContain("langwatch.input");

        const droppedState = fold.handleTraceSpanReceived(droppedEvent, fold.init());
        expect(droppedState.computedInput).toBeNull();
        expect(droppedState.computedOutput).toBeTruthy();
      });
    });
  });

  describe("given a span was already processed before the rule existed", () => {
    describe("when a later span is recorded under the new rule", () => {
      /** @scenario Dropping does not scrub already-stored traces */
      it("leaves the earlier span's input intact, dropping only later spans", async () => {
        const before = await makeHandler(null).handle(
          command({ project: "project-retro", attributes: IO_ATTRS }),
        );
        const beforeEvent = spanReceivedEventSchema.parse(
          before.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );
        expect(spanKeys(beforeEvent)).toContain("langwatch.input");

        const after = await makeHandler(policy({ input: "drop" })).handle(
          command({ project: "project-retro", attributes: IO_ATTRS }),
        );
        const afterEvent = spanReceivedEventSchema.parse(
          after.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
        );
        expect(spanKeys(afterEvent)).not.toContain("langwatch.input");

        // The already-emitted event is untouched by the later rule.
        expect(spanKeys(beforeEvent)).toContain("langwatch.input");
      });
    });
  });
});
