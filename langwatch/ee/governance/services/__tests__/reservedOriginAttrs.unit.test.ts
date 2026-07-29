// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * `governance_ocsf_events` and `governance_kpis` are auditor-facing streams
 * gated entirely on `langwatch.origin.kind` and keyed on
 * `langwatch.ingestion_source.id`. Those keys are only meaningful if the
 * RECEIVER is the only thing that can set them.
 *
 * The IngestionSource receiver strips-then-stamps. The general OTLP route
 * authenticates a project, has no IngestionSource to stamp from, and used to
 * pass caller attributes straight through — so a project API key could assert
 * governance origin plus any source id and forge audit rows within its own
 * tenant. These tests pin the strip, and pin that the strip is enough to make
 * the governance gate reject the forgery.
 *
 * @see specs/ai-gateway/governance/receiver-shapes.feature
 */

import { describe, expect, it } from "vitest";
import { isGovernanceOriginWireSpan } from "../../projections/governanceSpanFacts";
import { GOVERNANCE_ATTR } from "../governanceAttributeKeys";
import {
  isReservedOriginKey,
  stripReservedOriginAttrs,
  stripReservedOriginAttrsFromLogRequest,
  stripReservedOriginAttrsFromMetricRequest,
  stripReservedOriginAttrsFromTraceRequest,
} from "../reservedOriginAttrs";

function stringAttribute(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

/** The attributes an attacker would put on a span to forge governance origin. */
function forgedGovernanceAttrs() {
  return [
    stringAttribute("gen_ai.request.model", "gpt-5-mini"),
    stringAttribute(GOVERNANCE_ATTR.ORIGIN_KIND, "ingestion_source"),
    stringAttribute(GOVERNANCE_ATTR.INGESTION_SOURCE_ID, "src_victim"),
    stringAttribute(GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE, "claude_compliance"),
    stringAttribute(GOVERNANCE_ATTR.INGESTION_SOURCE_ORG_ID, "org_victim"),
  ];
}

function keysOf(attributes: { key?: string | null }[] | null | undefined) {
  return (attributes ?? []).map((attribute) => attribute.key);
}

describe("reserved origin attributes", () => {
  describe("given an attribute list carrying forged governance keys", () => {
    describe("when the list is stripped", () => {
      it("drops every langwatch.origin.* and langwatch.ingestion_source.* key", () => {
        expect(
          keysOf(stripReservedOriginAttrs(forgedGovernanceAttrs())),
        ).toEqual(["gen_ai.request.model"]);
      });
    });
  });

  describe("given attributes outside the reserved namespace", () => {
    describe("when the list is stripped", () => {
      it("keeps langwatch.origin, which is a different attribute", () => {
        // The prefixes carry a trailing dot on purpose: `langwatch.origin` is
        // the SDK / gateway provenance marker, not governance origin.
        expect(isReservedOriginKey("langwatch.origin")).toBe(false);
        expect(isReservedOriginKey("langwatch.organization_id")).toBe(false);
        expect(isReservedOriginKey("langwatch.origin.kind")).toBe(true);
      });

      it("returns the same array so ordinary spans allocate nothing", () => {
        const attributes = [
          stringAttribute("langwatch.origin", "gateway"),
          stringAttribute("langwatch.organization_id", "org_1"),
        ];
        expect(stripReservedOriginAttrs(attributes)).toBe(attributes);
      });
    });
  });

  describe("given an OTLP trace request forging governance origin", () => {
    function forgedTraceRequest() {
      return {
        resourceSpans: [
          {
            resource: { attributes: forgedGovernanceAttrs() },
            scopeSpans: [
              {
                scope: { attributes: forgedGovernanceAttrs() },
                spans: [{ attributes: forgedGovernanceAttrs() }],
              },
            ],
          },
        ],
      };
    }

    describe("when the request is stripped", () => {
      it("clears the reserved keys off spans and resources alike", () => {
        const request = forgedTraceRequest();

        stripReservedOriginAttrsFromTraceRequest(request);

        expect(keysOf(request.resourceSpans[0]!.resource.attributes)).toEqual([
          "gen_ai.request.model",
        ]);
        expect(
          keysOf(request.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes),
        ).toEqual(["gen_ai.request.model"]);
      });

      it("clears the reserved keys off the instrumentation scope", () => {
        // OTLP gives InstrumentationScope its own writable attribute list, so
        // it is a caller-controlled path into the reserved namespace exactly
        // like the resource and the span are.
        const request = forgedTraceRequest();

        stripReservedOriginAttrsFromTraceRequest(request);

        expect(
          keysOf(request.resourceSpans[0]!.scopeSpans[0]!.scope.attributes),
        ).toEqual(["gen_ai.request.model"]);
      });

      it("makes the governance gate reject the span the forgery produced", () => {
        const request = forgedTraceRequest();
        const span = request.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
        expect(isGovernanceOriginWireSpan(span)).toBe(true);

        stripReservedOriginAttrsFromTraceRequest(request);

        expect(isGovernanceOriginWireSpan(span)).toBe(false);
      });
    });
  });

  describe("given OTLP logs and metrics forging governance origin", () => {
    describe("when the request is stripped", () => {
      it("clears the reserved keys off log records, scopes and their resource", () => {
        const request = {
          resourceLogs: [
            {
              resource: { attributes: forgedGovernanceAttrs() },
              scopeLogs: [
                {
                  scope: { attributes: forgedGovernanceAttrs() },
                  logRecords: [{ attributes: forgedGovernanceAttrs() }],
                },
              ],
            },
          ],
        };

        stripReservedOriginAttrsFromLogRequest(request);

        expect(keysOf(request.resourceLogs[0]!.resource.attributes)).toEqual([
          "gen_ai.request.model",
        ]);
        expect(
          keysOf(request.resourceLogs[0]!.scopeLogs[0]!.scope.attributes),
        ).toEqual(["gen_ai.request.model"]);
        expect(
          keysOf(
            request.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes,
          ),
        ).toEqual(["gen_ai.request.model"]);
      });

      it("clears the reserved keys off metric resources", () => {
        const request = {
          resourceMetrics: [
            { resource: { attributes: forgedGovernanceAttrs() } },
          ],
        };

        stripReservedOriginAttrsFromMetricRequest(request);

        expect(keysOf(request.resourceMetrics[0]!.resource.attributes)).toEqual(
          ["gen_ai.request.model"],
        );
      });
    });
  });

  describe("given a request with no attributes at all", () => {
    describe("when the request is stripped", () => {
      it("tolerates missing spans, scopes, resources and attribute lists", () => {
        expect(() =>
          stripReservedOriginAttrsFromTraceRequest({
            resourceSpans: [{ scopeSpans: [{ spans: [{}] }] }, null],
          }),
        ).not.toThrow();
        expect(() =>
          stripReservedOriginAttrsFromLogRequest({ resourceLogs: null }),
        ).not.toThrow();
        expect(() =>
          stripReservedOriginAttrsFromMetricRequest({
            resourceMetrics: [null],
          }),
        ).not.toThrow();
      });
    });
  });
});
