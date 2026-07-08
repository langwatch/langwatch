import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "../registry";

/**
 * ADR-038 Decision 7 pins the GA pair: governance is default-on via exactly
 * two literals — the registry default and the auth-cli device-login gate's
 * call-site fallback. Reverting GA = flipping both back in one commit.
 * These tests fail loudly if either literal drifts independently.
 */
describe("governance GA defaults (ADR-038)", () => {
  describe("when the registry resolves release_ui_ai_governance_enabled", () => {
    it("defaults to enabled", () => {
      const flag = FEATURE_FLAGS.find(
        (f) => f.key === "release_ui_ai_governance_enabled",
      );
      expect(flag?.defaultValue).toBe(true);
    });
  });

  describe("when the CLI device-login gate evaluates its fallback", () => {
    it("defaults open — the 403 fires only for kill-switched orgs", () => {
      // The gate lives in a 1700-line Hono route file; asserting on the
      // source keeps the pin without spinning up the whole route. The
      // literal under test is the isEnabled defaultValue right after the
      // governance-gate comment block.
      const source = readFileSync(
        join(__dirname, "../../routes/auth-cli.ts"),
        "utf-8",
      );
      const gateBlock = source.slice(
        source.indexOf('"release_ui_ai_governance_enabled"'),
      );
      const defaultLine = gateBlock
        .split("\n")
        .find((line) => line.includes("defaultValue:"));
      expect(defaultLine).toContain("defaultValue: true");
    });
  });
});
