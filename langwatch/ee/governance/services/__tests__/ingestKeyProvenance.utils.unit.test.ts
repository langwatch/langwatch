import { describe, expect, it } from "vitest";

import {
  INGEST_KEY_ORIGIN_VALUE,
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

describe("stampIngestKeyProvenanceOnMetricRequest", () => {
  describe("given an OTLP metric request with no provenance", () => {
    it("stamps source, key id, origin and org on every resource", () => {
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
        expect(map["langwatch.origin"]).toBe(INGEST_KEY_ORIGIN_VALUE);
        expect(map["langwatch.organization_id"]).toBe("org_1");
      }
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
      expect(map["langwatch.origin"]).toBe(INGEST_KEY_ORIGIN_VALUE);
      // No duplicate keys remain after the strip-then-push.
      const sourceCount = request.resourceMetrics[0]!.resource.attributes.filter(
        (a) => a.key === "langwatch.source",
      ).length;
      expect(sourceCount).toBe(1);
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
