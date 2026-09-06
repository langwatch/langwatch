import { afterAll, describe, expect, it } from "vitest";
import { featureModuleClassesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(featureModuleClassesRule, { code, cwd: workspace.cwd, filename });
}

const PORT = "packages/features/agent/server/src/ports/agent.port.ts";
const ADAPTER = "packages/features/agent/server/src/adapters/agent.adapter.ts";

describe("given a strict feature port module", () => {
  describe("when it exports a concrete class named *Port", () => {
    /** @scenario "A concrete class in a port module is reported as needing to be abstract" */
    it("reports abstract", () => {
      const found = report("export class AgentPort {}", PORT);

      expect(found.map((entry) => entry.messageId)).toEqual(["abstract"]);
      expect(found[0].data.suffix).toBe("Port");
    });
  });

  describe("when it exports an abstract class named *Port", () => {
    /** @scenario "An abstract port class is left alone" */
    it("reports nothing", () => {
      expect(report("export abstract class AgentPort {}", PORT)).toEqual([]);
    });
  });
});

describe("given a strict feature adapter module", () => {
  describe("when the concrete class has no static create", () => {
    /** @scenario "A concrete adapter without static create is reported" */
    it("reports create", () => {
      const found = report("export class AgentAdapter {}", ADAPTER);

      expect(found.map((entry) => entry.messageId)).toEqual(["create"]);
    });
  });

  describe("when it exports a standalone function instead of a class", () => {
    /** @scenario "A standalone function in a strict feature module names its path and suffix" */
    it("reports standalone with the path and suffix", () => {
      const found = report("export function run() { return 1; }", ADAPTER);

      const standalone = found.find((entry) => entry.messageId === "standalone");
      expect(standalone.data.suffix).toBe("Adapter");
      expect(standalone.data.path).toBe(ADAPTER);
    });
  });

  describe("when the concrete class exposes static create", () => {
    /** @scenario "A well-formed concrete adapter is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "export class AgentAdapter { static create() { return new AgentAdapter(); } }",
          ADAPTER,
        ),
      ).toEqual([]);
    });
  });
});
