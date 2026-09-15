import { afterAll, describe, expect, it } from "vitest";
import { noPrototypeStubRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noPrototypeStubRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  describe("when it builds a stub with Object.create(X.prototype)", () => {
    /** @scenario "A prototype stub hides the class shape" */
    it("reports prototypeStub", () => {
      const found = report(
        "const stub = Object.create(AgentRunner.prototype);",
        "modules/agent/server/src/__tests__/agent.unit.test.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("prototypeStub");
      expect(found[0].data.name).toBe("AgentRunner");
    });
  });

  describe("when Object.create is given a plain object literal", () => {
    /** @scenario "Object.create without a class prototype is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "const stub = Object.create({});",
          "modules/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is not a test", () => {
    /** @scenario "A prototype stub outside a test file is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "const stub = Object.create(AgentRunner.prototype);",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
