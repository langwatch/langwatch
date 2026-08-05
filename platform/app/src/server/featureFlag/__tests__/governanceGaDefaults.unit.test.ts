import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "../registry";

/**
 * ADR-038 Decision 7 pins the flag pair that controls the governance
 * gate: the registry default and the auth-cli device-login gate's
 * call-site fallback. They must move TOGETHER: both true means
 * governance ships open (self-hosted works with zero configuration;
 * per-org kill switches in PostHog or the operator store re-arm the
 * gate). These tests fail loudly if either literal drifts independently.
 */
describe("governance flag defaults (ADR-038, GA: ships open)", () => {
  describe("when the registry resolves release_ui_ai_governance_enabled", () => {
    it("defaults to enabled so self-hosted installations need no configuration", () => {
      const flag = FEATURE_FLAGS.find(
        (f) => f.key === "release_ui_ai_governance_enabled",
      );
      expect(flag?.defaultValue).toBe(true);
    });
  });

  describe("when the CLI device-login gate evaluates its fallback", () => {
    it("defaults open at every call site, matching the registry", () => {
      // The gate lives in a 1700-line Hono route file; asserting on the
      // source keeps the pin without spinning up the whole route (the
      // gate's runtime behavior is covered by
      // auth-cli-personal-guard.integration.test.ts). Every occurrence of
      // the flag key is checked so an added second call site can't slip
      // past with a different default.
      const source = readFileSync(
        join(__dirname, "../../routes/auth-cli.ts"),
        "utf-8",
      );
      const occurrences = [
        ...source.matchAll(/"release_ui_ai_governance_enabled"/g),
      ];
      expect(occurrences.length).toBeGreaterThan(0);
      for (const match of occurrences) {
        const windowAfter = source.slice(match.index, match.index! + 400);
        const defaultLine = windowAfter
          .split("\n")
          .find((line) => line.includes("defaultValue:"));
        expect(defaultLine).toContain("defaultValue: true");
      }
    });
  });
});
