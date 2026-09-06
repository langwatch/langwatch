import { afterAll, describe, expect, it } from "vitest";
import { maxStatementsPerLineRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "packages/features/agent/server/src/services/agent.service.ts";

describe("given a strict feature service module", () => {
  describe("when two statements share a physical line", () => {
    /** @scenario "Two statements on one line are reported with the line number" */
    it("reports maxStatementsPerLine with the shared line", () => {
      const found = runRule(maxStatementsPerLineRule, {
        code: "export class AgentService { run() { const a = 1; const b = 2; } }",
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(found).toHaveLength(1);
      expect(found[0].message).toBe("Two statements share line 1. Put each on its own line.");
    });
  });

  describe("when each statement has its own line", () => {
    /** @scenario "One statement per line is left alone" */
    it("reports nothing", () => {
      const found = runRule(maxStatementsPerLineRule, {
        code: "export class AgentService {\n  run() {\n    const a = 1;\n    return a;\n  }\n}",
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(found).toEqual([]);
    });
  });
});
