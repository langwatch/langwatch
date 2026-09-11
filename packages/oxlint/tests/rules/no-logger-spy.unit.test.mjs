import { afterAll, describe, expect, it } from "vitest";
import { noLoggerSpyRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noLoggerSpyRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  describe("when it spies on an inline createLogger call", () => {
    /** @scenario "Spying on an inline createLogger call patches a real logger" */
    it("reports spyOnLogger", () => {
      const found = report(
        "vi.spyOn(createLogger('agent'), 'error');",
        "modules/agent/server/src/__tests__/agent.unit.test.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("spyOnLogger");
    });
  });

  describe("when it spies on a variable assigned from createLogger", () => {
    /** @scenario "Spying on a logger variable patches a real logger" */
    it("reports spyOnLogger", () => {
      const found = report(
        "const logger = createLogger('agent');\nvi.spyOn(logger, 'warn');",
        "modules/agent/server/src/__tests__/agent.unit.test.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("spyOnLogger");
    });
  });

  describe("when it spies on something unrelated to a logger", () => {
    /** @scenario "Spying on an unrelated object is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "const client = createClient();\nvi.spyOn(client, 'send');",
          "modules/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is not a test", () => {
    /** @scenario "A logger spy outside a test file is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "vi.spyOn(createLogger('agent'), 'error');",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
