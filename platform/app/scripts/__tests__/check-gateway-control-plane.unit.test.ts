/**
 * @vitest-environment node
 *
 * Tests for the pure decision logic behind
 * scripts/check-gateway-control-plane.ts: given what this worktree expects
 * and what a reused AI Gateway process actually reports on its
 * GET /debug/control-plane endpoint, decide whether to warn and what to
 * say. The probe (fetch, timeout, JSON parsing) is deliberately not under
 * test here, only the comparison and the resulting message.
 */

import { describe, expect, it } from "vitest";

import { evaluateGatewayReuse } from "../check-gateway-control-plane";

describe("evaluateGatewayReuse", () => {
  describe("when the reused gateway reports the control plane this worktree expects", () => {
    /** @scenario "a reused gateway pointed at the right control plane raises no warning" */
    it("raises no warning", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "ok", controlPlaneBaseUrl: "http://localhost:7580" },
      });

      expect(result).toEqual({ verdict: "ok", warning: null });
    });

    it("treats a trailing slash as the same URL", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "ok", controlPlaneBaseUrl: "http://localhost:7580/" },
      });

      expect(result.verdict).toBe("ok");
      expect(result.warning).toBeNull();
    });
  });

  describe("when the reused gateway reports a different control plane", () => {
    /** @scenario "a reused gateway pointed at a different control plane raises a loud, actionable warning" */
    it("raises a multi-line warning naming both the expected and the actual URL", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "ok", controlPlaneBaseUrl: "http://localhost:5560" },
      });

      expect(result.verdict).toBe("mismatch");
      expect(result.warning).toContain("http://localhost:7580");
      expect(result.warning).toContain("http://localhost:5560");
      expect(result.warning?.split("\n").length).toBeGreaterThan(3);
    });

    it("states how to fix it", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "ok", controlPlaneBaseUrl: "http://localhost:5560" },
      });

      expect(result.warning).toMatch(/fix/i);
      expect(result.warning).toContain("5563");
    });
  });

  describe("when the reused gateway's control-plane target cannot be verified", () => {
    /** @scenario "a reused gateway whose control-plane target cannot be verified is treated as suspect, not silently trusted" */
    it("raises a warning saying the target could not be verified", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "unreachable", reason: "fetch failed: ECONNREFUSED" },
      });

      expect(result.verdict).toBe("unverifiable");
      expect(result.warning).toContain("ECONNREFUSED");
      expect(result.warning).toContain("http://localhost:7580");
    });

    it("does not report ok", () => {
      const result = evaluateGatewayReuse({
        expectedControlPlaneUrl: "http://localhost:7580",
        gatewayPort: 5563,
        probe: { kind: "unreachable", reason: "timed out" },
      });

      expect(result.verdict).not.toBe("ok");
      expect(result.warning).not.toBeNull();
    });
  });
});
