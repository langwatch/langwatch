import { afterAll, describe, expect, it } from "vitest";
import { fallibleResultNamingRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const PORT = "modules/agent/server/src/ports/agent.port.ts";
const API = "modules/agent/contract/src/agent.api.ts";

function report(code, filename = PORT) {
  return runRule(fallibleResultNamingRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature port module", () => {
  describe("when a method hedges with the try prefix", () => {
    /** @scenario "A try-prefixed method is refused whatever its return type" */
    it("reports tryPrefix with the plain rename, for a nullable result", () => {
      const found = report(
        "export abstract class AgentPort { abstract tryFindById(): string | null; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryFindById", plain: "findById" });
    });

    /** @scenario "A try-prefixed method is refused whatever its return type" */
    it("reports tryPrefix for a result that is never nullable", () => {
      const found = report("export abstract class AgentPort { abstract tryGetById(): string; }");

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryGetById", plain: "getById" });
    });
  });

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

    /** @scenario "A missing result type is reported" */
    it("accepts a class whose implemented interface states the type", () => {
      const found = report(
        "export class AgentApp implements AgentApi { getById(input: { id: string }) { return this.service.getById(input); } }",
        "modules/agent/server/src/app/agent.app.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a nullable result is not a find method", () => {
    /** @scenario "Absence belongs to find methods alone" */
    it("reports nullableWithoutFind on a getter that may answer nothing", () => {
      const found = report(
        "export abstract class AgentPort { abstract getById(): Promise<string | undefined>; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
    });

    /** @scenario "Absence belongs to find methods alone" */
    it("accepts a find method that answers with undefined", () => {
      expect(
        report("export abstract class AgentPort { abstract findById(): string | undefined; }"),
      ).toEqual([]);
    });

    /** @scenario "Absence belongs to find methods alone" */
    it("accepts a getter that always answers or throws", () => {
      expect(report("export abstract class AgentPort { abstract getById(): string; }")).toEqual(
        [],
      );
    });
  });
});

describe("given a strict feature API interface", () => {
  describe("when an interface method hedges with the try prefix", () => {
    /** @scenario "A try-prefixed method is refused whatever its return type" */
    it("reports tryPrefix on the interface member", () => {
      const found = report(
        "export interface AgentApi { tryGetQueue(input: { id: string }): Promise<string | null>; }",
        API,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.plain])).toEqual([
        ["tryPrefix", "getQueue"],
      ]);
    });
  });
});
