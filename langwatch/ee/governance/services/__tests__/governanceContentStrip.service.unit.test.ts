/**
 * Unit coverage for GovernanceContentStripService — exercises the pure
 * `stripSpanAttributes` transform + the `governanceTargetOrgId`
 * discriminator without hitting Prisma. The end-to-end behaviour is
 * covered by `governanceContentStrip.integration.test.ts`; this file
 * documents the pure-function contract that the wire-in code relies
 * on.
 *
 * Spec: specs/ai-governance/no-spy-mode/no-spy-mode.feature
 */
import { describe, expect, it } from "vitest";

import { GovernanceContentStripService } from "../governanceContentStrip.service";

const baseAttrs = {
  "langwatch.origin": "gateway",
  "langwatch.organization_id": "org-1",
  "gen_ai.input.messages": [{ role: "user", content: "secret" }],
  "gen_ai.output.messages": [{ role: "assistant", content: "reply" }],
  "gen_ai.system_instructions": "you are helpful",
  "gen_ai.tool.call.arguments": '{"q": "weather"}',
  "gen_ai.tool.call.result": "27°C",
  "gen_ai.request.model": "gpt-5-mini",
  "gen_ai.usage.input_tokens": 12,
};

describe("GovernanceContentStripService.stripSpanAttributes", () => {
  describe("when mode is full", () => {
    it("returns the SAME object reference (zero-allocation happy path)", () => {
      const result = GovernanceContentStripService.stripSpanAttributes({
        attributes: baseAttrs,
        mode: "full",
      });
      expect(result).toBe(baseAttrs);
    });
  });

  describe("when mode is strip_io", () => {
    const result = GovernanceContentStripService.stripSpanAttributes({
      attributes: baseAttrs,
      mode: "strip_io",
    });

    it("removes IO content keys", () => {
      expect(result["gen_ai.input.messages"]).toBeUndefined();
      expect(result["gen_ai.output.messages"]).toBeUndefined();
      expect(result["gen_ai.system_instructions"]).toBeUndefined();
    });

    it("preserves non-content gen_ai metadata (model, tokens, cost)", () => {
      expect(result["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(result["gen_ai.usage.input_tokens"]).toBe(12);
    });

    it("preserves langwatch.organization_id + langwatch.origin", () => {
      expect(result["langwatch.organization_id"]).toBe("org-1");
      expect(result["langwatch.origin"]).toBe("gateway");
    });

    it("does NOT strip tool-call payloads (those are strip_all-only)", () => {
      expect(result["gen_ai.tool.call.arguments"]).toBeDefined();
      expect(result["gen_ai.tool.call.result"]).toBe("27°C");
    });

    it("stamps strip-marker attributes for the UI banner", () => {
      expect(result["langwatch.governance.content_stripped"]).toBe(true);
      expect(result["langwatch.governance.content_strip_mode"]).toBe(
        "strip_io",
      );
    });

    it("does not mutate the input object", () => {
      expect(baseAttrs["gen_ai.input.messages"]).toBeDefined();
    });
  });

  describe("when mode is strip_all", () => {
    const result = GovernanceContentStripService.stripSpanAttributes({
      attributes: baseAttrs,
      mode: "strip_all",
    });

    it("strips IO + tool-call payloads", () => {
      expect(result["gen_ai.input.messages"]).toBeUndefined();
      expect(result["gen_ai.output.messages"]).toBeUndefined();
      expect(result["gen_ai.system_instructions"]).toBeUndefined();
      expect(result["gen_ai.tool.call.arguments"]).toBeUndefined();
      expect(result["gen_ai.tool.call.result"]).toBeUndefined();
    });

    it("preserves non-content metadata", () => {
      expect(result["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(result["gen_ai.usage.input_tokens"]).toBe(12);
    });
  });

  describe("when no content keys are present", () => {
    it("returns the input object unchanged (no marker stamped)", () => {
      const noContent = {
        "langwatch.origin": "gateway",
        "gen_ai.request.model": "gpt-5-mini",
      };
      const result = GovernanceContentStripService.stripSpanAttributes({
        attributes: noContent,
        mode: "strip_io",
      });
      expect(result).toBe(noContent);
      expect(result["langwatch.governance.content_stripped"]).toBeUndefined();
    });
  });
});

describe("GovernanceContentStripService.governanceTargetOrgId", () => {
  describe("when origin is 'gateway' and organization_id is set", () => {
    it("returns the organization id (the policy target)", () => {
      const orgId = GovernanceContentStripService.governanceTargetOrgId({
        "langwatch.origin": "gateway",
        "langwatch.organization_id": "org-acme",
      });
      expect(orgId).toBe("org-acme");
    });
  });

  describe("when origin is not 'gateway'", () => {
    it("returns null (customer-app traces are not subject to the policy)", () => {
      const orgId = GovernanceContentStripService.governanceTargetOrgId({
        "langwatch.origin": "application",
        "langwatch.organization_id": "org-acme",
      });
      expect(orgId).toBeNull();
    });
  });

  describe("when origin is 'gateway' but organization_id is missing", () => {
    it("returns null (cannot apply policy without an org binding)", () => {
      const orgId = GovernanceContentStripService.governanceTargetOrgId({
        "langwatch.origin": "gateway",
      });
      expect(orgId).toBeNull();
    });
  });

  describe("when organization_id is empty string", () => {
    it("returns null (defensive)", () => {
      const orgId = GovernanceContentStripService.governanceTargetOrgId({
        "langwatch.origin": "gateway",
        "langwatch.organization_id": "",
      });
      expect(orgId).toBeNull();
    });
  });
});
