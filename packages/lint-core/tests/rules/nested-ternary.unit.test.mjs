import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetBaselineCache } from "../../src/baseline.mjs";
import { nestedTernaryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {}, web: {} } } },
});

afterAll(() => workspace.cleanup());
afterEach(() => resetBaselineCache());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";

function report(code, options = []) {
  return runRule(nestedTernaryRule, { code, cwd: workspace.cwd, filename: SERVICE, options });
}

describe("given a strict feature service module", () => {
  describe("when a ternary's consequent is itself a ternary", () => {
    /** @scenario "A nested ternary is reported on the inner ternary" */
    it("reports nested on the inner ternary", () => {
      const found = report("export function pick(a) { return a ? (a > 1 ? 1 : 2) : 3; }");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("nested");
      expect(found[0].data).toEqual({ position: "consequent" });
    });
  });

  describe("when a ternary's alternate is itself a ternary", () => {
    /** @scenario "A nested ternary is reported on the inner ternary" */
    it("reports nested with position alternate", () => {
      const found = report("export function pick(a) { return a ? 1 : a > 1 ? 2 : 3; }");

      expect(found[0]?.data).toEqual({ position: "alternate" });
    });
  });

  describe("when neither branch nests a ternary", () => {
    /** @scenario "A ternary with no nested branch is left alone" */
    it("reports nothing", () => {
      expect(report("export function pick(a) { return a ? 1 : 2; }")).toEqual([]);
    });
  });

  describe("when the file is baselined for nested-ternary", () => {
    /** @scenario "A baselined file reports nothing" */
    it("reports nothing even though the code nests a ternary", () => {
      workspace.write(
        "packages/architecture-lint/src/oxlint-baseline.json",
        JSON.stringify({
          version: 0,
          entries: [{ key: `nested-ternary|${SERVICE}`, measured: "2026-09-06" }],
        }),
      );
      resetBaselineCache();

      expect(report("export function pick(a) { return a ? (a > 1 ? 1 : 2) : 3; }")).toEqual([]);
    });
  });
});
