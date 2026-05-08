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
  PROVENANCE_ATTR_BINDING_ID,
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_TEMPLATE_ID,
  stampBindingProvenanceOnLogRequest,
  stampBindingProvenanceOnTraceRequest,
} from "../bindingProvenance.utils";

const PROVENANCE = {
  bindingId: "uib-123",
  templateId: "tmpl-456",
  templateSlug: "claude_code",
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
    it("creates the attributes array and stamps all 3 keys", () => {
      const req: any = { resourceSpans: [{ resource: {} }] };
      const stamped = stampBindingProvenanceOnTraceRequest(req, PROVENANCE);
      expect(stamped).toBe(1);
      const attrs = req.resourceSpans[0].resource.attributes;
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBe("tmpl-456");
      expect(findAttr(attrs, PROVENANCE_ATTR_BINDING_ID)).toBe("uib-123");
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
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
              ],
            },
          },
        ],
      };
      stampBindingProvenanceOnTraceRequest(req, PROVENANCE);
      const attrs = req.resourceSpans[0].resource.attributes;
      // Receiver-stamped values win.
      expect(findAttr(attrs, PROVENANCE_ATTR_TEMPLATE_ID)).toBe("tmpl-456");
      expect(findAttr(attrs, PROVENANCE_ATTR_SOURCE)).toBe("claude_code");
      // Non-protected attrs are preserved.
      expect(findAttr(attrs, "service.name")).toBe("my-service");
      // No duplicate provenance keys.
      const templateIdCount = attrs.filter(
        (a: any) => a.key === PROVENANCE_ATTR_TEMPLATE_ID,
      ).length;
      expect(templateIdCount).toBe(1);
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
    it("stamps all 3 provenance keys onto each resource", () => {
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
      expect(findAttr(attrs, "host.name")).toBe("h1");
    });
  });
});
