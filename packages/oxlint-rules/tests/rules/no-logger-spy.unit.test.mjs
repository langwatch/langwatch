import { afterAll, describe, expect, it } from "vitest";

import { noLoggerSpyRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
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
        "modules/agent/process/src/__tests__/agent.unit.test.ts",
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
        "modules/agent/process/src/__tests__/agent.unit.test.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("spyOnLogger");
    });
  });

  describe("when it spies on an imported logger", () => {
    /** @scenario "Spying on an imported logger patches a real logger" */
    it("reports spyOnLogger on the spy's line", () => {
      const found = report(
        [
          'import { logger } from "../logger";',
          "",
          'vi.spyOn(logger, "warn");',
          'vi.spyOn(deps.appLogger, "fatal");',
          'vi.spyOn(request_log, "trace");',
        ].join("\n"),
        "modules/agent/process/src/__tests__/agent.unit.test.ts",
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["spyOnLogger", 3],
        ["spyOnLogger", 4],
        ["spyOnLogger", 5],
      ]);
    });
  });

  describe("when a name only ends in the letters log", () => {
    /** @scenario "A catalog or dialog is not a logger" */
    it("reports nothing", () => {
      expect(
        report(
          'vi.spyOn(catalog, "info");\nvi.spyOn(dialog, "warn");\nvi.spyOn(logger, "child");',
          "modules/agent/process/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when it spies on something unrelated to a logger", () => {
    /** @scenario "Spying on an unrelated object is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "const client = createClient();\nvi.spyOn(client, 'send');",
          "modules/agent/process/src/__tests__/agent.unit.test.ts",
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
          "modules/agent/process/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
