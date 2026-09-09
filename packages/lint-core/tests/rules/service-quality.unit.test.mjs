import { afterAll, describe, expect, it } from "vitest";
import { serviceQualityRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";

function report(code) {
  return runRule(serviceQualityRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

describe("given a strict feature service module", () => {
  // `duplicateMember`'s native ClassBody check is exercised at the unit level
  // by construction, not through a passing `.service.ts` fixture: oxc's
  // parser now hard-fails the whole file ("Parsing failed") on two method
  // definitions sharing a name, instead of silently dropping one the way it
  // used to — verified empirically against the pinned oxlint. That is *more*
  // than the old source-rescan workaround needed to recover from, so the
  // workaround (and its O(n*m) rescan) is deleted rather than kept: there is
  // no longer a parseable `.service.ts` file for it to catch that the native
  // per-member check would miss.
  describe("when two members with different static-ness share a name", () => {
    /** @scenario "A static and an instance member of the same name do not collide" */
    it("reports nothing", () => {
      expect(
        report("export class AgentService { static bar() { return 1; } bar() { return 2; } }"),
      ).toEqual([]);
    });
  });

  describe("when an object literal declares the same key twice", () => {
    /** @scenario "A duplicate object literal key is reported by name" */
    it("reports duplicateObjectKey", () => {
      const found = report("export const config = { a: 1, a: 2 };");

      expect(found.map((entry) => entry.messageId)).toEqual(["duplicateObjectKey"]);
      expect(found[0].data.name).toBe("a");
    });
  });

  describe("when a *Service class with static create keeps a public constructor", () => {
    /** @scenario "A public constructor beside static create is reported by class name" */
    it("reports publicConstructor naming the class", () => {
      const found = report(
        "export class AgentService { constructor() {} static create() { return new AgentService(); } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["publicConstructor"]);
      expect(found[0].data.name).toBe("AgentService");
      expect(found[0].message).toBe(
        "`AgentService` has `static create`, so its constructor must be `private`" +
          " so callers cannot bypass it. Mark the constructor `private`.",
      );
    });
  });

  describe("when the constructor is already private", () => {
    /** @scenario "A private constructor beside static create is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "export class AgentService { private constructor() {} static create() { return new AgentService(); } }",
        ),
      ).toEqual([]);
    });
  });
});
