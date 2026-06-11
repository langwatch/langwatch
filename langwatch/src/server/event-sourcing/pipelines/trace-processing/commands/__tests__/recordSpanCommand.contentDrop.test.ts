/**
 * Integration tests for the scoped data-privacy content DROP wired into
 * RecordSpanCommand. The drop runs at this single command choke point, so the
 * emitted SpanReceivedEvent carries the already-dropped span: both the span
 * store and the trace-summary fold (driven here for real) see no dropped
 * content. The policy is supplied directly (the DB-backed resolution path has
 * its own integration tests); the real drop logic + real fold run end-to-end.
 */
import { describe, expect, it } from "vitest";

import { createTenantId, type Command } from "../../../../";
import { stripOtlpSpanContent } from "~/server/data-privacy/applyOtlpSpanContentDrop";
import { PRIVACY_DROPPED_MARKER_ATTR } from "~/server/data-privacy/dropKeyCatalog";
import {
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type { OtlpKeyValue } from "../../schemas/otlp";
import type { PIIRedactionLevel, RecordSpanCommandData } from "../../schemas/commands";
import { RECORD_SPAN_COMMAND_TYPE } from "../../schemas/constants";
import { TraceSummaryFoldProjection } from "../../projections/traceSummary.foldProjection";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";

function policy({
  input = "capture" as Disposition,
  output = "capture" as Disposition,
  system = "capture" as Disposition,
  tools = "capture" as Disposition,
  customDropKeys = [] as string[],
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
    pii: { level: "essential" },
    secrets: { enabled: true, customPatterns: [] },
    customDropKeys,
  };
}

function makeHandler(dropPolicy: ResolvedDataPrivacy | null): RecordSpanCommand {
  const deps: RecordSpanCommandDependencies = {
    piiRedactionService: { redactSpan: async () => {} },
    costEnrichmentService: { enrichSpan: async () => {} },
    tokenEstimationService: { estimateSpanTokens: async () => {} },
    contentDropService: {
      dropSpanContent: async ({ span }) =>
        dropPolicy
          ? stripOtlpSpanContent({ span, policy: dropPolicy })
          : { droppedCount: 0, droppedCategories: [] },
    },
  };
  return new RecordSpanCommand(deps);
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
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: "trace-1",
    tenantId: createTenantId(project),
    data: {
      tenantId: project,
      occurredAt: 1_000_000,
      span: {
        traceId: "trace-1",
        spanId: "span-1",
        name: "test-span",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1_000_000, high: 0 },
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
    },
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

        expect(spanKeys(events[0]!)).not.toContain("langwatch.input");
        expect(spanKeys(events[0]!)).toContain("langwatch.output");
        expect(spanKeys(events[0]!)).toContain("gen_ai.request.model");
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

        expect(spanKeys(events[0]!)).not.toContain("langwatch.input");
      });
    });
  });

  describe("given a rule that drops input and output", () => {
    describe("when a gateway-origin span is recorded", () => {
      /** @scenario Dropping applies to gateway traffic */
      it("drops both input and output for a gateway-origin span", async () => {
        const events = await makeHandler(
          policy({ input: "drop", output: "drop" }),
        ).handle(
          command({
            attributes: IO_ATTRS,
            resourceAttributes: { "langwatch.origin": "gateway" },
          }),
        );

        expect(spanKeys(events[0]!)).not.toContain("langwatch.input");
        expect(spanKeys(events[0]!)).not.toContain("langwatch.output");
        expect(spanKeys(events[0]!)).toContain(PRIVACY_DROPPED_MARKER_ATTR);
      });
    });
  });

  describe("given input is dropped and the trace summary is folded", () => {
    describe("when the fold derives the computed input and output", () => {
      /** @scenario The trace-level computed input is cleared when input is dropped */
      it("yields no computed input from the fold but keeps the computed output", async () => {
        const fold = new TraceSummaryFoldProjection({
          store: { store: async () => undefined, get: async () => null },
        });

        // Control: no drop policy — the fold derives a computed input.
        const captured = await makeHandler(null).handle(
          command({ project: "project-keep", attributes: IO_ATTRS }),
        );
        const keptState = fold.handleTraceSpanReceived(captured[0]!, fold.init());
        expect(keptState.computedInput).toBeTruthy();

        // Drop input — the same fold path now sees no input on the event.
        const dropped = await makeHandler(policy({ input: "drop" })).handle(
          command({ project: "project-drop", attributes: IO_ATTRS }),
        );
        expect(spanKeys(dropped[0]!)).not.toContain("langwatch.input");

        const droppedState = fold.handleTraceSpanReceived(
          dropped[0]!,
          fold.init(),
        );
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
        expect(spanKeys(before[0]!)).toContain("langwatch.input");

        const after = await makeHandler(policy({ input: "drop" })).handle(
          command({ project: "project-retro", attributes: IO_ATTRS }),
        );
        expect(spanKeys(after[0]!)).not.toContain("langwatch.input");

        // The already-emitted event is untouched by the later rule.
        expect(spanKeys(before[0]!)).toContain("langwatch.input");
      });
    });
  });
});
