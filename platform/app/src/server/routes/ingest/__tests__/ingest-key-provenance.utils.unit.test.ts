import { describe, expect, it } from "vitest";

import {
  AI_TOOL_ORIGIN_VALUE,
  CODING_AGENT_ORIGIN_VALUE,
  dropForeignScopesForVscodeKey,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
  originForIngestSourceType,
  PROVENANCE_ATTR_API_KEY_ID,
  stampIngestKeyProvenanceOnLogRequest,
  stampIngestKeyProvenanceOnMetricRequest,
} from "../ingest-key-provenance.utils";

const PROVENANCE = {
  apiKeyId: "key_abc",
  sourceType: "claude_code",
  organizationId: "org_1",
};

function attrMap(attrs: { key: string; value: { stringValue?: string | null } }[]) {
  return Object.fromEntries(attrs.map((a) => [a.key, a.value.stringValue]));
}

describe("originForIngestSourceType", () => {
  describe("given a CLI coding-assistant source type", () => {
    it.each(["claude_code", "codex", "gemini", "opencode", "cursor"])(
      "maps %s to coding_agent",
      (sourceType) => {
        expect(originForIngestSourceType(sourceType)).toBe(CODING_AGENT_ORIGIN_VALUE);
      },
    );
  });

  describe("given any other ingest source type", () => {
    it.each(["claude_cowork", "otel_generic", "workato", "unknown_tool"])(
      "maps %s to ai_tool",
      (sourceType) => {
        expect(originForIngestSourceType(sourceType)).toBe(AI_TOOL_ORIGIN_VALUE);
      },
    );
  });
});

describe("stampIngestKeyProvenanceOnMetricRequest", () => {
  describe("given an OTLP metric request from a coding assistant", () => {
    it("stamps source, key id, coding_agent origin and org on every resource", () => {
      const request = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "claude" } }],
            },
          },
          { resource: { attributes: [] } },
        ],
      };
      const stamped = stampIngestKeyProvenanceOnMetricRequest(request, PROVENANCE);
      expect(stamped).toBe(2);
      for (const rm of request.resourceMetrics) {
        const map = attrMap(rm.resource.attributes);
        expect(map["langwatch.source"]).toBe("claude_code");
        expect(map["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
        expect(map["langwatch.organization_id"]).toBe("org_1");
      }
    });
  });

  describe("given a generic ai_tool ingest source", () => {
    it("stamps the ai_tool origin", () => {
      const request = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(request, {
        ...PROVENANCE,
        sourceType: "claude_cowork",
      });
      const map = attrMap(request.resourceMetrics[0]!.resource.attributes);
      expect(map["langwatch.source"]).toBe("claude_cowork");
      expect(map["langwatch.origin"]).toBe(AI_TOOL_ORIGIN_VALUE);
    });
  });

  describe("given a payload that forges its own provenance keys", () => {
    it("overwrites them with the receiver-authoritative values", () => {
      const request = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "langwatch.source", value: { stringValue: "spoofed" } },
                {
                  key: PROVENANCE_ATTR_API_KEY_ID,
                  value: { stringValue: "spoofed_key" },
                },
                { key: "langwatch.origin", value: { stringValue: "gateway" } },
              ],
            },
          },
        ],
      };
      stampIngestKeyProvenanceOnMetricRequest(request, PROVENANCE);
      enforceApiKeyIdOnMetricRequest(request, PROVENANCE.apiKeyId);
      const map = attrMap(request.resourceMetrics[0]!.resource.attributes);
      expect(map["langwatch.source"]).toBe("claude_code");
      expect(map[PROVENANCE_ATTR_API_KEY_ID]).toBe("key_abc");
      expect(map["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
      // No duplicate keys remain after the strip-then-push.
      const sourceCount = request.resourceMetrics[0]!.resource.attributes.filter(
        (a) => a.key === "langwatch.source",
      ).length;
      expect(sourceCount).toBe(1);
    });
  });

  describe("given a bundled (non-billable) ingest source", () => {
    it("stamps langwatch.cost.non_billable = 'true' when nonBillable is true", () => {
      const request = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(request, {
        ...PROVENANCE,
        nonBillable: true,
      });
      const map = attrMap(request.resourceMetrics[0]!.resource.attributes);
      expect(map["langwatch.cost.non_billable"]).toBe("true");
    });

    it("stamps 'false' when nonBillable is false and omits when undefined", () => {
      const billed = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(billed, {
        ...PROVENANCE,
        nonBillable: false,
      });
      expect(
        attrMap(billed.resourceMetrics[0]!.resource.attributes)[
          "langwatch.cost.non_billable"
        ],
      ).toBe("false");

      const unset = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(unset, PROVENANCE);
      expect(
        attrMap(unset.resourceMetrics[0]!.resource.attributes)[
          "langwatch.cost.non_billable"
        ],
      ).toBeUndefined();
    });
  });

  describe("given a template-derived ingest key", () => {
    it("stamps the template id only when present", () => {
      const withTemplate = {
        resourceMetrics: [{ resource: { attributes: [] } }],
      };
      stampIngestKeyProvenanceOnMetricRequest(withTemplate, {
        ...PROVENANCE,
        templateId: "tmpl_1",
      });
      expect(
        attrMap(withTemplate.resourceMetrics[0]!.resource.attributes)[
          "langwatch.template.id"
        ],
      ).toBe("tmpl_1");

      const noTemplate = {
        resourceMetrics: [{ resource: { attributes: [] } }],
      };
      stampIngestKeyProvenanceOnMetricRequest(noTemplate, PROVENANCE);
      expect(
        attrMap(noTemplate.resourceMetrics[0]!.resource.attributes)[
          "langwatch.template.id"
        ],
      ).toBeUndefined();
    });
  });
});

// Claude Code (and other coding assistants) export OTLP *logs*, not spans, so
// the bundled-cost marker has to ride on the log request too — the trace path
// alone would never stamp it for them.
describe("stampIngestKeyProvenanceOnLogRequest", () => {
  describe("given a bundled (non-billable) coding-assistant log request", () => {
    it("stamps origin, source and langwatch.cost.non_billable on every resource", () => {
      const request = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "claude-code" } },
              ],
            },
          },
          { resource: { attributes: [] } },
        ],
      };
      const stamped = stampIngestKeyProvenanceOnLogRequest(request, {
        ...PROVENANCE,
        nonBillable: true,
      });
      expect(stamped).toBe(2);
      for (const rl of request.resourceLogs) {
        const map = attrMap(rl.resource.attributes);
        expect(map["langwatch.source"]).toBe("claude_code");
        expect(map["langwatch.origin"]).toBe(CODING_AGENT_ORIGIN_VALUE);
        expect(map["langwatch.cost.non_billable"]).toBe("true");
      }
    });
  });

  describe("given a billed log request", () => {
    it("stamps 'false' when nonBillable is false", () => {
      const request = { resourceLogs: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnLogRequest(request, {
        ...PROVENANCE,
        nonBillable: false,
      });
      expect(
        attrMap(request.resourceLogs[0]!.resource.attributes)[
          "langwatch.cost.non_billable"
        ],
      ).toBe("false");
    });
  });
});

/**
 * The redaction deny-list exempts `langwatch.api_key.id` by name, so the only
 * thing standing between that exemption and a free "store my secret verbatim"
 * slot is that the receiver rewrites the value on EVERY authenticated request.
 * These pin that rule, including the branch with no ApiKey row behind it.
 */
describe("enforceApiKeyIdOnTraceRequest", () => {
  function requestWith({
    resourceAttrs = [],
    spanAttrs = [],
    eventAttrs = [],
    linkAttrs = [],
  }: {
    resourceAttrs?: { key: string; value: { stringValue: string } }[];
    spanAttrs?: { key: string; value: { stringValue: string } }[];
    eventAttrs?: { key: string; value: { stringValue: string } }[];
    linkAttrs?: { key: string; value: { stringValue: string } }[];
  }) {
    return {
      resourceSpans: [
        {
          resource: { attributes: [...resourceAttrs] },
          scopeSpans: [
            {
              spans: [
                {
                  attributes: [...spanAttrs],
                  events: [{ attributes: [...eventAttrs] }],
                  links: [{ attributes: [...linkAttrs] }],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  const forged = {
    key: PROVENANCE_ATTR_API_KEY_ID,
    value: { stringValue: "sk-lw-attacker-secret" },
  };

  /** @scenario A caller cannot forge the API key id attribute */
  it("replaces a payload-supplied resource value with the authenticated id", () => {
    const request = requestWith({ resourceAttrs: [forged] });

    enforceApiKeyIdOnTraceRequest(request, "key_real");

    const map = attrMap(request.resourceSpans[0]!.resource.attributes);
    expect(map[PROVENANCE_ATTR_API_KEY_ID]).toBe("key_real");
  });

  it("leaves exactly one copy of the attribute on the resource", () => {
    const request = requestWith({ resourceAttrs: [forged, forged] });

    enforceApiKeyIdOnTraceRequest(request, "key_real");

    const count = request.resourceSpans[0]!.resource.attributes.filter(
      (a) => a.key === PROVENANCE_ATTR_API_KEY_ID,
    ).length;
    expect(count).toBe(1);
  });

  /** @scenario A caller cannot forge the API key id attribute */
  it.each([
    ["span", "spanAttrs"],
    ["span event", "eventAttrs"],
    ["span link", "linkAttrs"],
  ])("drops a payload-supplied %s copy outright", (_label, field) => {
    const request = requestWith({ [field]: [forged] });

    enforceApiKeyIdOnTraceRequest(request, "key_real");

    const span = request.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    const holders = [span, span.events[0]!, span.links[0]!];
    for (const holder of holders) {
      expect(holder.attributes.some((a) => a.key === PROVENANCE_ATTR_API_KEY_ID)).toBe(
        false,
      );
    }
  });

  /** @scenario Legacy project key auth leaves no API key id behind */
  it("removes a forged value and writes nothing when there is no ApiKey row", () => {
    const request = requestWith({ resourceAttrs: [forged] });

    const applied = enforceApiKeyIdOnTraceRequest(request, null);

    expect(applied).toBe(0);
    expect(
      request.resourceSpans[0]!.resource.attributes.some(
        (a) => a.key === PROVENANCE_ATTR_API_KEY_ID,
      ),
    ).toBe(false);
  });

  it("keeps unrelated attributes untouched", () => {
    const request = requestWith({
      resourceAttrs: [
        forged,
        { key: "service.name", value: { stringValue: "acme-api" } },
      ],
    });

    enforceApiKeyIdOnTraceRequest(request, "key_real");

    const map = attrMap(request.resourceSpans[0]!.resource.attributes);
    expect(map["service.name"]).toBe("acme-api");
  });
});

describe("dropForeignScopesForVscodeKey", () => {
  const traceRequest = (scopes: (string | undefined)[]) => ({
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: scopes.map((name) => ({
          scope: name === undefined ? undefined : { name },
          spans: [{ attributes: [] }],
        })),
      },
    ],
  });

  describe("given a copilot_vscode key carrying foreign instrumentation scopes", () => {
    /** @scenario Foreign OTLP traffic on a copilot_vscode key is dropped at the receiver */
    it("drops every non-copilot scope and keeps copilot's own", () => {
      const request = traceRequest([
        "github.copilot",
        "my-own-service",
        "@opentelemetry/instrumentation-http",
        undefined,
      ]);

      const dropped = dropForeignScopesForVscodeKey(request, "copilot_vscode");

      expect(dropped).toBe(3);
      expect(request.resourceSpans[0]!.scopeSpans.map((s) => s.scope?.name)).toEqual([
        "github.copilot",
      ]);
    });

    it("drops a resource group entirely when nothing copilot remains", () => {
      const request = traceRequest(["my-own-service"]);

      dropForeignScopesForVscodeKey(request, "copilot_vscode");

      expect(request.resourceSpans).toEqual([]);
    });

    it("accepts the legacy @github/copilot scope alias", () => {
      const request = traceRequest(["@github/copilot"]);

      const dropped = dropForeignScopesForVscodeKey(request, "copilot_vscode");

      expect(dropped).toBe(0);
      expect(request.resourceSpans).toHaveLength(1);
    });
  });

  describe("given any other ingest source type", () => {
    it("is a strict no-op — other keys are not scope-gated", () => {
      const request = traceRequest(["my-own-service"]);

      const dropped = dropForeignScopesForVscodeKey(request, "copilot_cli");

      expect(dropped).toBe(0);
      expect(request.resourceSpans[0]!.scopeSpans).toHaveLength(1);
    });
  });

  describe("given a copilot_vscode metrics request", () => {
    it("gates scope-metrics the same way", () => {
      const request = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              { scope: { name: "github.copilot" }, metrics: [] },
              { scope: { name: "my-own-service" }, metrics: [] },
            ],
          },
        ],
      };

      const dropped = dropForeignScopesForVscodeKey(request, "copilot_vscode");

      expect(dropped).toBe(1);
      expect(request.resourceMetrics[0]!.scopeMetrics.map((s) => s.scope?.name)).toEqual([
        "github.copilot",
      ]);
    });
  });
});
