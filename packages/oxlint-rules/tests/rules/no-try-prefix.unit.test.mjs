import { afterAll, describe, expect, it } from "vitest";
import { noTryPrefixRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const PORT = "modules/agent/process/src/ports/agent.port.ts";
const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const API = "modules/agent/contract/src/agent.api.ts";

function report(code, filename = PORT) {
  return runRule(noTryPrefixRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature port module", () => {
  describe("when a method is named with the try prefix", () => {
    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports noTryPrefix on an abstract port method with no body", () => {
      const found = report(
        "export abstract class AgentPort { abstract tryFindById(): string | null; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["noTryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryFindById" });
    });

    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports noTryPrefix on a concrete method that has no catch at all", () => {
      const found = report(
        "export class AgentService { tryGetById(): string | null {"
          + " return this.cache.get(this.id) ?? null; } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["noTryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryGetById" });
    });

    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports noTryPrefix on a free function", () => {
      const found = report("export function tryParse(input: string): number | null { return Number(input); }");

      expect(found.map((entry) => entry.messageId)).toEqual(["noTryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryParse" });
    });
  });

  describe("when the message is read by the author", () => {
    /** @scenario "The message never claims a catch exists" */
    it("states the naming defect and the condition that picks the rename, without mentioning a catch", () => {
      const found = report(
        "export class AgentService { tryGetById(): string | null {"
          + " return this.cache.get(this.id) ?? null; } }",
        SERVICE,
      );

      expect(found[0].message).not.toMatch(/catch/i);
      expect(found[0].message).toContain("named for how it behaves on failure");
      expect(found[0].message).toContain("drop `try`");
      expect(found[0].message).toContain("get<Noun>");
      expect(found[0].message).toContain("find<Noun>");
      expect(found[0].message).toContain("throw the domain error instead of null");
      expect(found[0].message).toMatch(/find\*.*still answers null/);
    });
  });

  describe("when a method has a private accessibility", () => {
    /** @scenario "A private try-prefixed method is left alone" */
    it("accepts a private method named with the try prefix", () => {
      const found = report(
        "export class AgentService { private tryGetById(): string | null { return null; } }",
        SERVICE,
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a method does not carry the try prefix", () => {
    /** @scenario "A method named without the try prefix is left alone" */
    it("accepts a plain find method", () => {
      expect(
        report("export abstract class AgentPort { abstract findById(): string | null; }"),
      ).toEqual([]);
    });
  });
});

describe("given a strict feature API interface", () => {
  describe("when an interface method carries the try prefix", () => {
    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports noTryPrefix on the interface member", () => {
      const found = report(
        "export interface AgentApi { tryGetQueue(input: { id: string }): Promise<string | null>; }",
        API,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.name])).toEqual([
        ["noTryPrefix", "tryGetQueue"],
      ]);
    });
  });
});
