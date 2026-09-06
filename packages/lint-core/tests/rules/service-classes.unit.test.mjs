import { afterAll, describe, expect, it } from "vitest";
import { serviceClassesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "packages/features/agent/server/src/services/agent.service.ts";

function report(code) {
  return runRule(serviceClassesRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

describe("given a strict feature service module", () => {
  describe("when it exports a standalone function", () => {
    /** @scenario "A standalone exported function is reported by name" */
    it("reports standalone naming the function", () => {
      const found = report(
        "export function run() { return 1; } export class AgentService { static create() { return new AgentService(); } }",
      );

      expect(found.map((entry) => entry.messageId)).toContain("standalone");
      expect(found.find((entry) => entry.messageId === "standalone").data.name).toBe("run");
    });
  });

  describe("when it defines no *Service class", () => {
    /** @scenario "A service module missing its Service class is reported" */
    it("reports missing", () => {
      const found = report("export class Helper {}");

      expect(found.map((entry) => entry.messageId)).toEqual(["missing"]);
    });
  });

  describe("when the *Service class has no static create", () => {
    /** @scenario "A service class without static create is reported" */
    it("reports create", () => {
      const found = report("export class AgentService {}");

      expect(found.map((entry) => entry.messageId)).toEqual(["create"]);
    });
  });

  describe("when the module follows the shape", () => {
    /** @scenario "A well-formed service module is left alone" */
    it("reports nothing", () => {
      expect(
        report("export class AgentService { static create() { return new AgentService(); } }"),
      ).toEqual([]);
    });
  });
});
