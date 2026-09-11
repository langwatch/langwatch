import { afterAll, describe, expect, it } from "vitest";
import { featureSideHoldsNoAppRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(featureSideHoldsNoAppRule, { code, cwd: workspace.cwd, filename });
}

describe("given a process-side feature file", () => {
  describe("when a class implements a contract *Api type", () => {
    /** @scenario "A class implementing a contract Api type is the module's app" */
    it("reports implementsApi", () => {
      const found = report(
        "class AgentHandle implements AgentApi {}",
        "apps/api/src/features/agent/agent.composition.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("implementsApi");
      expect(found[0].data.contract).toBe("AgentApi");
    });
  });

  describe("when a class extends a contract *Api type", () => {
    /** @scenario "A class extending a contract Api type is the module's app" */
    it("reports implementsApi", () => {
      const found = report(
        "class AgentHandle extends AgentApi {}",
        "apps/worker/src/app/agent/agent.composition.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("implementsApi");
    });
  });

  describe("when a class is named like a module app", () => {
    /** @scenario "A class named *App is the module's app" */
    it("reports reservedName", () => {
      const found = report("class AgentApp {}", "apps/tasks/src/agent-backfill.ts");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("reservedName");
      expect(found[0].data.name).toBe("AgentApp");
    });
  });

  describe("when a class is named Extended*", () => {
    /** @scenario "A class named Extended* is the module's app" */
    it("reports reservedName", () => {
      const found = report(
        "class ExtendedAgent {}",
        "apps/api/src/features/agent/agent.composition.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("reservedName");
    });
  });

  describe("when a class has an ordinary name", () => {
    /** @scenario "An ordinary installer class is not the module's app" */
    it("reports nothing", () => {
      expect(
        report(
          "class AgentComposition {}",
          "apps/api/src/features/agent/agent.composition.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A test file may define an *App class" */
    it("reports nothing", () => {
      expect(
        report("class AgentApp {}", "apps/api/src/features/agent/__tests__/agent.test.ts"),
      ).toEqual([]);
    });
  });
});
