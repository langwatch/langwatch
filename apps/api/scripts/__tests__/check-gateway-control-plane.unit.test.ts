/**
 * @vitest-environment node
 * Tests for the decision logic: given worktree expectations vs what the
 * gateway reports on GET /debug/control-plane, decide to warn and what to
 * say. Probe logic (fetch, timeout, JSON parsing) is tested elsewhere.
 */

import { describe, expect, it } from "vitest";

import { evaluateGatewayReuse } from "../check-gateway-control-plane.ts";

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
    /** @scenario "gateway with mismatched control plane raises actionable warning" */
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
    /** @scenario "unverifiable gateway target is not silently trusted" */
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
