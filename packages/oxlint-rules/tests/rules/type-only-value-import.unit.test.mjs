import { afterAll, describe, expect, it } from "vitest";
import { typeOnlyValueImportRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
  files: {
    "modules/agent/server/src/services/agent.types.ts": "export interface AgentConfig {}\n",
    "modules/agent/server/src/services/agent.mixed.ts":
      "export type AgentMode = 'a';\nexport class AgentRunner {}\n",
  },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(typeOnlyValueImportRule, { code, cwd: workspace.cwd, filename });
}

describe("given a relative import of a sibling module", () => {
  describe("when the imported name is only declared as an interface", () => {
    /** @scenario "A value import of an interface is a runtime link failure" */
    it("reports valueImportOfType", () => {
      const found = report(
        "import { AgentConfig } from './agent.types';",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("valueImportOfType");
      expect(found[0].data.name).toBe("AgentConfig");
    });
  });

  describe("when the import already says `import type`", () => {
    /** @scenario "An import type of an interface is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "import type { AgentConfig } from './agent.types';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the imported name is a class", () => {
    /** @scenario "A value import of a class is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "import { AgentRunner } from './agent.mixed';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the target file cannot be resolved", () => {
    /** @scenario "An unresolvable import specifier is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "import { Missing } from './does-not-exist';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
