import { afterAll, describe, expect, it } from "vitest";
import { noRuntimeReflectionRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noRuntimeReflectionRule, { code, cwd: workspace.cwd, filename });
}

describe("given a governed module source file", () => {
  describe("when it constructs a Proxy", () => {
    /** @scenario "new Proxy stands in for a class" */
    it("reports proxy", () => {
      const found = report(
        "export const handle = new Proxy({}, {});",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("proxy");
    });
  });

  describe("when it calls Reflect.get", () => {
    /** @scenario "Reflect.get reaches around a method call" */
    it("reports reflect", () => {
      const found = report(
        "export const value = Reflect.get(target, key);",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("reflect");
      expect(found[0].data.member).toBe("get");
    });
  });

  describe("when it calls Object.defineProperty on a plain object", () => {
    /** @scenario "Object.defineProperty patches a non-prototype object" */
    it("reports defineProperty", () => {
      const found = report(
        "Object.defineProperty(target, 'x', { value: 1 });",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("defineProperty");
    });
  });

  describe("when it calls Object.defineProperty on a class prototype", () => {
    /** @scenario "Object.defineProperty on a class prototype is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "Object.defineProperty(Agent.prototype, 'x', { value: 1 });",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A test file may use Proxy" */
    it("reports nothing", () => {
      expect(
        report(
          "export const handle = new Proxy({}, {});",
          "modules/agent/server/src/__tests__/agent.fixture.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is packages/test-harness", () => {
    /** @scenario "createApiFixture's own Proxy is the sanctioned exception" */
    it("reports nothing", () => {
      expect(
        report("export const handle = new Proxy({}, {});", "packages/test-harness/src/index.ts"),
      ).toEqual([]);
    });
  });
});
