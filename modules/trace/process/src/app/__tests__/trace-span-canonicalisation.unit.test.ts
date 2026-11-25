import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { decodeOtlpSpan } from "@langwatch/trace-contract/otlp-decoding";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { SpanNormalizationPipelineService } from "../../features/span/services/span-normalization.service.ts";
import type { TraceLegacyRead } from "../../services/trace-viewer.service.ts";
import { TraceModule, type TraceAppDependencies } from "../trace.app.ts";

const MODEL = "claude-sonnet-4-5";
const canonicalisation = TraceCanonicalisationService.create();

const app = TraceModule.fromDependencies(
  createApiFixture<TraceAppDependencies>({
    traces: createApiFixture<TraceAppDependencies["traces"]>({
      canonicalisation,
      read: createApiFixture<TraceLegacyRead>(),
    }),
  }),
);

const claudeModelCall: OtlpSpan = {
  traceId: "trace-1",
  spanId: "span-1",
  parentSpanId: null,
  name: "claude_code.llm_request",
  kind: 1,
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000001000000000",
  attributes: [
    { key: "model", value: { stringValue: MODEL } },
    { key: "session.id", value: { stringValue: "sess-1" } },
    { key: "input_tokens", value: { intValue: 12 } },
    { key: "output_tokens", value: { intValue: 34 } },
  ],
  events: [],
  links: [],
  status: { code: null, message: null },
  flags: null,
  droppedAttributesCount: 0,
  droppedEventsCount: 0,
  droppedLinksCount: 0,
};
const scope = { name: "com.anthropic.claude_code", version: null };

describe("TraceModule.canonicalizeSpanAttributes", () => {
  describe("given a Claude Code model call decoded by the contract decoder", () => {
    /** @scenario "Trace's API canonicalises a span's attributes as ingest does" */
    it("answers the attributes and events ingest stores, the model under its canonical name", () => {
      const decoded = decodeOtlpSpan({
        tenantId: "tenant-1",
        otlpSpan: claudeModelCall,
        otlpResource: null,
        otlpInstrumentationScope: scope,
      });
      const canonical = app.canonicalizeSpanAttributes({
        spanAttributes: decoded.spanAttributes,
        events: decoded.events,
        span: decoded,
      });
      const ingested = SpanNormalizationPipelineService.create(
        canonicalisation,
      ).normalizeSpanReceived({
        tenantId: "tenant-1",
        span: claudeModelCall,
        resource: null,
        instrumentationScope: scope,
      });

      expect(canonical.attributes).toEqual(ingested.spanAttributes);
      expect(canonical.events).toEqual(ingested.events);
      expect(canonical.attributes["gen_ai.request.model"]).toBe(MODEL);
      expect({
        ...decoded,
        spanAttributes: canonical.attributes,
        events: canonical.events,
      }).toEqual(ingested);
    });
  });

  describe("given a Claude Code span whose resource declares the launcher's session", () => {
    /** @scenario a launcher's declared session groups every harness session it runs */
    it("names the declared session as the conversation, through the API and through ingest", () => {
      const resource = {
        attributes: [{ key: "langwatch.session.id", value: { stringValue: "agent_scout" } }],
      };
      const decoded = decodeOtlpSpan({
        tenantId: "tenant-1",
        otlpSpan: claudeModelCall,
        otlpResource: resource,
        otlpInstrumentationScope: scope,
      });
      const canonical = app.canonicalizeSpanAttributes({
        spanAttributes: decoded.spanAttributes,
        events: decoded.events,
        span: decoded,
      });
      const ingested = SpanNormalizationPipelineService.create(
        canonicalisation,
      ).normalizeSpanReceived({
        tenantId: "tenant-1",
        span: claudeModelCall,
        resource,
        instrumentationScope: scope,
      });

      expect(canonical.attributes["gen_ai.conversation.id"]).toBe("agent_scout");
      expect(ingested.spanAttributes["gen_ai.conversation.id"]).toBe("agent_scout");
    });
  });

  describe("given a Claude Code prompt record whose resource declares the launcher's session", () => {
    /** @scenario a launcher's declared session groups every harness session it runs */
    it("threads the record on the declared session through the API", () => {
      const lifted = app.canonicalizeLogRecord({
        scopeName: "com.anthropic.claude_code.events",
        body: "claude_code.user_prompt",
        attributes: { "event.name": "user_prompt", prompt: "hi", "session.id": "cc-run-1" },
        resourceAttributes: { "langwatch.session.id": "agent_scout" },
      });

      expect(lifted.attributes["langwatch.thread.id"]).toBe("agent_scout");
    });
  });
});
