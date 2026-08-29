import { describe, expect, it } from "vitest";
import { classifyForLangy } from "../langy-permission-policy";

describe("classifyForLangy", () => {
  it("fails closed for unknown families, actions, and malformed permissions", () => {
    for (const permission of [
      "billing:create",
      "piiExport:create",
      "impersonation:update",
      "somethingNobodyHasWrittenYet:view",
      "prompts:purge",
      "prompts:exfiltrate",
      "nonsense",
      "",
    ]) {
      expect(classifyForLangy(permission).disposition, permission).toBe("excluded");
    }
  });

  it("explains how an unknown family must be assessed", () => {
    const verdict = classifyForLangy("billing:create");

    expect(verdict).toMatchObject({ disposition: "excluded" });
    if (verdict.disposition !== "excluded") throw new Error("unreachable");
    expect(verdict.reason).toContain("DELEGABLE_FAMILIES");
    expect(verdict.reason).toContain("OFF_LIMITS_FAMILIES");
  });

  it("refuses destructive actions across delegable families", () => {
    for (const permission of [
      "prompts:manage",
      "prompts:delete",
      "prompts:share",
      "datasets:manage",
      "datasets:delete",
      "datasets:share",
      "traces:manage",
      "traces:delete",
      "traces:share",
    ]) {
      const verdict = classifyForLangy(permission);
      expect(verdict.disposition, permission).toBe("excluded");
      if (verdict.disposition === "excluded") {
        expect(verdict.reason.length, permission).toBeGreaterThan(0);
      }
    }
  });

  it("allows the intended least-privilege reads and writes", () => {
    for (const permission of [
      "experiments:view",
      "prompts:view",
      "prompts:create",
      "evaluations:create",
      "traces:view",
      "project:view",
    ]) {
      expect(classifyForLangy(permission).disposition, permission).toBe("granted");
    }
  });
});
