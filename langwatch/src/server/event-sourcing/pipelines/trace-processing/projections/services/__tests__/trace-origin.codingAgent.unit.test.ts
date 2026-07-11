/**
 * R4: verify the ORIGIN path for the REAL Claude Code tracing spans, not just
 * the log-derived path.
 *
 * The read-time enrichment gate (`TraceService.enrichCodingAgentTrace`) only
 * runs when a trace's resolved `langwatch.origin` is `coding_agent`. That was
 * confirmed for the log-derived traces; this test proves the REAL
 * `com.anthropic.claude_code.tracing` spans reach the same origin, so the gate
 * fires for them too.
 *
 * The path is: an ingestion key carrying `ingestSourceType = "claude_code"`
 * makes the receiver stamp `langwatch.origin = coding_agent` onto the RESOURCE
 * attributes of EVERY resourceSpans (a provenance stamp an upstream can't
 * forge) — including the tracing-scope spans — and the trace-summary fold's
 * `hoistOrigin` then treats a resource-level origin as an explicit signal and
 * hoists it onto the trace attributes (= trace metadata). If either link were
 * missing, enrichment would silently never run for real tracing spans.
 */
import { describe, expect, it } from "vitest";

import {
  CODING_AGENT_ORIGIN_VALUE,
  stampIngestKeyProvenanceOnTraceRequest,
} from "@ee/governance/services/ingestKeyProvenance.utils";
import { CLAUDE_CODE_TRACING_SCOPE } from "~/server/app-layer/traces/claude-code-log-events";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { CODING_AGENT_ORIGIN } from "~/server/traces/claude-code-log-enrichment";

import type { NormalizedSpan } from "../../../schemas/spans";
import { TraceOriginService } from "../trace-origin.service";

/**
 * A REAL Claude Code tracing span: scope `com.anthropic.claude_code.tracing`,
 * NO span-level origin (the provenance stamp lands on the resource, never per
 * span), and the receiver-stamped `coding_agent` origin on the resource.
 */
function tracingScopeSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return {
    parentSpanId: null,
    spanAttributes: {},
    resourceAttributes: { "langwatch.origin": CODING_AGENT_ORIGIN_VALUE },
    instrumentationScope: { name: CLAUDE_CODE_TRACING_SCOPE, version: null },
    ...overrides,
  } as NormalizedSpan;
}

function emptyState(): TraceSummaryData {
  return { attributes: {} } as TraceSummaryData;
}

describe("coding-agent origin path for real tracing spans", () => {
  describe("given the ingestion key stamps provenance on a tracing-scope resource", () => {
    it("writes coding_agent onto the resource attributes", () => {
      const request = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "claude-code" } },
              ],
            },
            // The real tracing spans ride under this scope; provenance stamps
            // the RESOURCE, so scope is irrelevant to the stamp — asserted only
            // to make the fixture faithful to the tracing path.
            scopeSpans: [{ scope: { name: CLAUDE_CODE_TRACING_SCOPE } }],
          },
        ],
      };

      const stamped = stampIngestKeyProvenanceOnTraceRequest(request, {
        apiKeyId: "key_abc",
        sourceType: "claude_code",
        organizationId: "org_1",
      });

      expect(stamped).toBe(1);
      const attrs = Object.fromEntries(
        request.resourceSpans[0]!.resource.attributes.map((a) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrs["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
    });
  });

  describe("given a real tracing-scope span carrying resource-level coding_agent origin", () => {
    it("hoists coding_agent onto the trace attributes (root span)", () => {
      const merged: Record<string, string> = {};
      new TraceOriginService().hoistOrigin({
        state: emptyState(),
        span: tracingScopeSpan(),
        mergedAttributes: merged,
      });

      expect(merged["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
    });

    it("hoists coding_agent from a non-root tracing span too (resource origin, no span origin)", () => {
      const merged: Record<string, string> = {};
      new TraceOriginService().hoistOrigin({
        state: emptyState(),
        span: tracingScopeSpan({ parentSpanId: "parent-span" }),
        mergedAttributes: merged,
      });

      expect(merged["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
    });
  });

  describe("the stamped origin and the enrichment gate agree", () => {
    it("uses the exact same value on both ends of the path", () => {
      // The value the provenance stamp writes is the value the read-time
      // enrichment gate checks; if these ever diverged, enrichment would never
      // run for real tracing spans.
      expect(CODING_AGENT_ORIGIN).toBe(CODING_AGENT_ORIGIN_VALUE);
    });
  });
});
