/**
 * @vitest-environment node
 *
 * Unit coverage for the receiver-side provenance stamping. Pure
 * mutation against the parsed OTLP request shape — no DB, no network.
 *
 * Spec: specs/ai-gateway/governance/personal-project-ingest-via-template.feature
 *       specs/ai-gateway/governance/template-ottl-principal-guard.feature
 */
import { describe, expect, it } from "vitest";

import {
  BINDING_ORIGIN_VALUE,
  PROVENANCE_ATTR_BINDING_ID,
  PROVENANCE_ATTR_ORGANIZATION_ID,
  PROVENANCE_ATTR_ORIGIN,
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_TEMPLATE_ID,
  stampBindingProvenanceOnLogRequest,
  stampBindingProvenanceOnTraceRequest,
} from "../bindingProvenance.utils";

const PROVENANCE = {
  bindingId: "uib-123",
  templateId: "tmpl-456",
  sourceType: "claude_code",
  organizationId: "org-789",
};

function findAttr(
  attrs: { key: string; value: { stringValue?: string } }[] | null | undefined,
  key: string,
) {
  return attrs?.find((a) => a.key === key)?.value.stringValue;
}

describe("stampBindingProvenanceOnTraceRequest", () => {
  describe("when the request has no resourceSpans", () => {
    it("returns 0 stamped resources", () => {
      const stamped = stampBindingProvenanceOnTraceRequest(
        { resourceSpans: [] },
        PROVENANCE,
      );
      expect(stamped).toBe(0);
    });
  });

  describe("when the request has a resource without attributes", () => {
    it("creates the attributes array and stamps all 5 keys (provenance + no-spy gate)", () => {
      const req: any = { resourceSpans: [{ resource: {} }] };
      const stamped = stampBindingProvenanceOnTraceRequest(req, PROVENANCE);
      expect(stamped).toBe(1);
      const attrs = req.resourceSpans[0].resource.attributes;
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBe("tmpl-456");
      expect(findAttr(attrs, PROVENANCE_ATTR_BINDING_ID)).toBe("uib-123");
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
      // Closes ralph-loop gap #5 — these two stamps make the strip
      // pipeline's governanceTargetOrgId() succeed, so binding-routed
      // traces respect the org's no-spy / strip-IO policy.
      expect(findAttr(attrs, PROVENANCE_ATTR_ORIGIN)).toBe(BINDING_ORIGIN_VALUE);
      expect(findAttr(attrs, PROVENANCE_ATTR_ORGANIZATION_ID)).toBe("org-789");
    });
  });

  describe("when a payload claims its own values for protected provenance keys", () => {
    it("strips the payload-supplied values and stamps the binding-authoritative ones", () => {
      const req: any = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "my-service" } },
                {
                  key: PROVENANCE_ATTR_TEMPLATE_ID,
                  value: { stringValue: "evil-template" },
                },
                {
                  key: PROVENANCE_ATTR_SOURCE,
                  value: { stringValue: "evil-source" },
                },
                // Forge attempt on the no-spy gate — claims a different
                // org so the strip pipeline picks up the wrong policy.
                {
                  key: PROVENANCE_ATTR_ORGANIZATION_ID,
                  value: { stringValue: "evil-org" },
                },
                {
                  key: PROVENANCE_ATTR_ORIGIN,
                  value: { stringValue: "fake-origin" },
                },
              ],
            },
          },
        ],
      };
      stampBindingProvenanceOnTraceRequest(req, PROVENANCE);
      const attrs = req.resourceSpans[0].resource.attributes;
      // Receiver-stamped values win across all 5 keys.
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBe("tmpl-456");
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
      expect(findAttr(attrs, PROVENANCE_ATTR_ORGANIZATION_ID)).toBe("org-789");
      expect(findAttr(attrs, PROVENANCE_ATTR_ORIGIN)).toBe(BINDING_ORIGIN_VALUE);
      // Non-protected attrs are preserved.
      expect(findAttr(attrs, "service.name")).toBe("my-service");
      // No duplicate provenance keys.
      for (const key of [
        PROVENANCE_ATTR_TEMPLATE_ID,
        PROVENANCE_ATTR_BINDING_ID,
        PROVENANCE_ATTR_SOURCE,
        PROVENANCE_ATTR_ORIGIN,
        PROVENANCE_ATTR_ORGANIZATION_ID,
      ]) {
        const count = attrs.filter((a: any) => a.key === key).length;
        expect(count).toBe(1);
      }
    });
  });

  describe("when the binding is template-free (coding assistant)", () => {
    it("omits langwatch.template.id and stamps langwatch.source from sourceType", () => {
      const req: any = { resourceSpans: [{ resource: { attributes: [] } }] };
      stampBindingProvenanceOnTraceRequest(req, {
        bindingId: "uib-cc",
        templateId: null,
        sourceType: "claude_code",
        organizationId: "org-789",
      });
      const attrs = req.resourceSpans[0].resource.attributes;
      // No template row, so no template id is stamped.
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBeUndefined();
      // Source still resolves from the canonical tool slug.
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
      expect(findAttr(attrs, PROVENANCE_ATTR_BINDING_ID)).toBe("uib-cc");
      expect(findAttr(attrs, PROVENANCE_ATTR_ORIGIN)).toBe(BINDING_ORIGIN_VALUE);
      expect(findAttr(attrs, PROVENANCE_ATTR_ORGANIZATION_ID)).toBe("org-789");
    });
  });

  describe("when there are multiple resourceSpans entries", () => {
    it("stamps each one independently", () => {
      const req: any = {
        resourceSpans: [
          { resource: { attributes: [] } },
          { resource: { attributes: [] } },
          { resource: { attributes: [] } },
        ],
      };
      const stamped = stampBindingProvenanceOnTraceRequest(req, PROVENANCE);
      expect(stamped).toBe(3);
      for (const rs of req.resourceSpans) {
        expect(findAttr(rs.resource.attributes, PROVENANCE_ATTR_BINDING_ID)).toBe(
          "uib-123",
        );
      }
    });
  });
});

describe("stampBindingProvenanceOnLogRequest", () => {
  describe("when the request has resourceLogs entries", () => {
    it("stamps all 5 provenance keys onto each resource", () => {
      const req: any = {
        resourceLogs: [
          { resource: { attributes: [{ key: "host.name", value: { stringValue: "h1" } }] } },
        ],
      };
      const stamped = stampBindingProvenanceOnLogRequest(req, PROVENANCE);
      expect(stamped).toBe(1);
      const attrs = req.resourceLogs[0].resource.attributes;
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBe("tmpl-456");
      expect(findAttr(attrs, PROVENANCE_ATTR_BINDING_ID)).toBe("uib-123");
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
      expect(findAttr(attrs, PROVENANCE_ATTR_ORIGIN)).toBe(BINDING_ORIGIN_VALUE);
      expect(findAttr(attrs, PROVENANCE_ATTR_ORGANIZATION_ID)).toBe("org-789");
      expect(findAttr(attrs, "host.name")).toBe("h1");
    });
  });
});
