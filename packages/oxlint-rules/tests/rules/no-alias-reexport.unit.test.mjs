import { afterAll, describe, expect, it } from "vitest";
import { noAliasReexportRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noAliasReexportRule, { code, cwd: workspace.cwd, filename });
}

describe("given a barrel file", () => {
  describe("when it re-exports a symbol from another module under a new name", () => {
    /** @scenario "A re-export alias hides which name is real" */
    it("reports aliasReexport", () => {
      const found = report(
        "export { AgentApi as Agent } from './agent.api';",
        "modules/agent/server/src/index.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("aliasReexport");
      expect(found[0].data.local).toBe("AgentApi");
      expect(found[0].data.exported).toBe("Agent");
    });
  });

  describe("when it re-exports a local symbol under a new name", () => {
    /** @scenario "A local export alias hides which name is real" */
    it("reports aliasReexport", () => {
      const found = report(
        "const AgentApi = 1;\nexport { AgentApi as Agent };",
        "modules/agent/server/src/index.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("aliasReexport");
    });
  });

  describe("when the export keeps the same name", () => {
    /** @scenario "An export under its own name is allowed" */
    it("reports nothing", () => {
      expect(
        report("export { AgentApi } from './agent.api';", "modules/agent/server/src/index.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file is not a barrel", () => {
    /** @scenario "An alias export outside a barrel is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "export { AgentApi as Agent } from './agent.api';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
