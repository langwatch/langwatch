import { describe, expect, it } from "vitest";

import {
  AI_TOOL_ORIGIN_VALUE,
  CODING_AGENT_ORIGIN_VALUE,
  originForIngestSourceType,
  stampIngestKeyProvenanceOnLogRequest,
  stampIngestKeyProvenanceOnMetricRequest,
} from "../ingestKeyProvenance.utils";

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
        expect(originForIngestSourceType(sourceType)).toBe(
          CODING_AGENT_ORIGIN_VALUE,
        );
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
          { resource: { attributes: [{ key: "service.name", value: { stringValue: "claude" } }] } },
          { resource: { attributes: [] } },
        ],
      };
      const stamped = stampIngestKeyProvenanceOnMetricRequest(request, PROVENANCE);
      expect(stamped).toBe(2);
      for (const rm of request.resourceMetrics) {
        const map = attrMap(rm.resource.attributes);
        expect(map["langwatch.source"]).toBe("claude_code");
        expect(map["langwatch.api_key.id"]).toBe("key_abc");
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
                { key: "langwatch.api_key.id", value: { stringValue: "spoofed_key" } },
                { key: "langwatch.origin", value: { stringValue: "gateway" } },
              ],
            },
          },
        ],
      };
      stampIngestKeyProvenanceOnMetricRequest(request, PROVENANCE);
      const map = attrMap(request.resourceMetrics[0]!.resource.attributes);
      expect(map["langwatch.source"]).toBe("claude_code");
      expect(map["langwatch.api_key.id"]).toBe("key_abc");
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
      const withTemplate = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(withTemplate, { ...PROVENANCE, templateId: "tmpl_1" });
      expect(attrMap(withTemplate.resourceMetrics[0]!.resource.attributes)["langwatch.template.id"]).toBe("tmpl_1");

      const noTemplate = { resourceMetrics: [{ resource: { attributes: [] } }] };
      stampIngestKeyProvenanceOnMetricRequest(noTemplate, PROVENANCE);
      expect(attrMap(noTemplate.resourceMetrics[0]!.resource.attributes)["langwatch.template.id"]).toBeUndefined();
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
          { resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] } },
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
