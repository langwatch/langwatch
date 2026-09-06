import { afterAll, describe, expect, it } from "vitest";
import { fallibleResultNamingRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const PORT = "packages/features/agent/server/src/ports/agent.port.ts";

function report(code) {
  return runRule(fallibleResultNamingRule, { code, cwd: workspace.cwd, filename: PORT });
}

describe("given a strict feature port module", () => {
  describe("when a method uses the redundant require prefix", () => {
    /** @scenario "The require prefix is reported with a rename fix" */
    it("reports requirePrefix", () => {
      const found = report("export abstract class AgentPort { abstract requireById(): string; }");

      expect(found.map((entry) => entry.messageId)).toContain("requirePrefix");
      expect(found.find((e) => e.messageId === "requirePrefix").message).toBe(
        "Rename `requireById`: drop the `require` prefix; a method already returns or throws." +
          " Rename the method without the `require` prefix.",
      );
    });
  });

  describe("when a method has no explicit return type", () => {
    /** @scenario "A missing result type is reported" */
    it("reports noResultType", () => {
      const found = report("export abstract class AgentPort { abstract findById(); }");

      expect(found.map((entry) => entry.messageId)).toEqual(["noResultType"]);
    });
  });

  describe("when a nullable return type has no try prefix", () => {
    /** @scenario "An untried absence is reported with the try-prefixed rename" */
    it("reports untriedAbsence with the capitalized rename", () => {
      const found = report(
        "export abstract class AgentPort { abstract findById(): string | null; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["untriedAbsence"]);
      expect(found[0].data).toEqual({ name: "findById", Name: "FindById" });
    });
  });

  describe("when a try-prefixed method's return type is never nullable", () => {
    /** @scenario "A try-prefixed method that cannot be absent is reported" */
    it("reports tryWithoutAbsence", () => {
      const found = report("export abstract class AgentPort { abstract tryFindById(): string; }");

      expect(found.map((entry) => entry.messageId)).toEqual(["tryWithoutAbsence"]);
    });
  });

  describe("when a try-prefixed method's return type is nullable", () => {
    /** @scenario "A well-formed try method is left alone" */
    it("reports nothing", () => {
      expect(
        report("export abstract class AgentPort { abstract tryFindById(): string | null; }"),
      ).toEqual([]);
    });
  });
});
