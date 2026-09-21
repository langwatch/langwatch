import { afterAll, describe, expect, it } from "vitest";
import { serviceMemberSpacingRule } from "../../src/index.mjs";
import { createFixtureWorkspace, expectFix, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

describe("given a strict feature service module", () => {
  describe("when two methods sit on adjacent lines", () => {
    /** @scenario "Adjacent methods without a blank line are reported and fixed" */
    it("reports memberSpacing and inserts a blank line", () => {
      const found = runRule(serviceMemberSpacingRule, {
        code: "export class AgentService {\n  a() { return 1; }\n  b() { return 2; }\n}",
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("memberSpacing");
    });

    /** @scenario "Adjacent methods without a blank line are reported and fixed" */
    it("writes the blank line that `pnpm lint:fix` would write", () => {
      expectFix(serviceMemberSpacingRule, {
        code: "export class AgentService {\n  a() { return 1; }\n  b() { return 2; }\n}",
        cwd: workspace.cwd,
        filename: SERVICE,
        output: "export class AgentService {\n  a() { return 1; }\n\n  b() { return 2; }\n}",
      });
    });
  });

  describe("when a blank line already separates them", () => {
    /** @scenario "Methods already separated by a blank line are left alone" */
    it("reports nothing", () => {
      const found = runRule(serviceMemberSpacingRule, {
        code: "export class AgentService {\n  a() { return 1; }\n\n  b() { return 2; }\n}",
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(found).toEqual([]);
    });
  });
});
