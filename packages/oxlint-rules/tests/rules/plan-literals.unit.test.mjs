import { afterAll, describe, expect, it } from "vitest";

import { planLiteralsRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

function report(code, filename = SERVICE) {
  return runRule(planLiteralsRule, { code, cwd: workspace.cwd, filename });
}

function ids(code, filename) {
  return report(code, filename).map((entry) => entry.messageId);
}

describe("given production source outside the catalogue", () => {
  describe("when an object assigns two limit fields", () => {
    /** @scenario "An object stating two limit fields is reported" */
    it("reports it and names both fields", () => {
      const found = report("const plan = { maxMembers: 2, maxMessagesPerMonth: 50_000 };");

      expect(found.map((entry) => entry.messageId)).toEqual(["statesPlanFacts"]);
      expect(found[0].message).toContain("maxMembers");
      expect(found[0].message).toContain("maxMessagesPerMonth");
    });
  });

  describe("when the message says where the facts belong", () => {
    /** @scenario "The message names the catalogue accessor" */
    it("names @langwatch/plans and the catalogue accessor", () => {
      const found = report("const plan = { maxMembers: 2, canPublish: true };");

      expect(found[0].message).toContain("@langwatch/plans");
      expect(found[0].message).toContain("planCatalogue.plan(");
    });
  });

  describe("when an object assigns one limit field", () => {
    /** @scenario "An object stating one limit field is left alone" */
    it("reports nothing", () => {
      expect(ids("const fixture = { maxMembers: 2, name: 'Free' };")).toEqual([]);
    });
  });

  describe("when the fields are priced ones", () => {
    /** @scenario "A price table beside another limit is reported" */
    it("reports the literal", () => {
      expect(
        ids("const plan = { prices: { USD: 0, EUR: 0 }, userPrice: { USD: 32, EUR: 29 } };"),
      ).toEqual(["statesPlanFacts"]);
    });
  });

  describe("when the limit fields read their values rather than state them", () => {
    /** @scenario "A schema or a mapping that reads limit fields is left alone" */
    it("reports nothing, and still reports a literal definition on its line", () => {
      const found = report(
        [
          "const schema = z.object({ maxMembers: z.number(), maxMembersLite: z.number() });",
          "const view = { maxMembers: plan.maxMembers, canPublish: plan.canPublish, maxMembersLite: 3 };",
          "const FREE = { maxMembers: 2, canPublish: false };",
        ].join("\n"),
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([["statesPlanFacts", 3]]);
    });
  });

  describe("when the keys are computed", () => {
    /** @scenario "Computed keys are not read as limit fields" */
    it("reports nothing", () => {
      expect(ids("const plan = { [members]: 2, [messages]: 50_000 };")).toEqual([]);
    });
  });

  describe("when the literal names the declaration it sits on", () => {
    /** @scenario "The message names the declaration the literal sits on" */
    it("names the declaration", () => {
      const found = report("const FREE_PLAN = { maxMembers: 2, canPublish: true };");

      expect(found[0].message).toContain("FREE_PLAN");
    });
  });
});

describe("given a file the rule does not govern", () => {
  describe("when it is the catalogue itself", () => {
    /** @scenario "The plans package states its own facts" */
    it("reports nothing", () => {
      expect(
        ids(
          "const plan = { maxMembers: 2, maxMessagesPerMonth: 50_000 };",
          "packages/plans/src/catalogue-data.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when it is a test", () => {
    /** @scenario "Test files keep their plan fixtures" */
    it("reports nothing", () => {
      expect(
        ids(
          "const plan = { maxMembers: 2, canPublish: true };",
          "modules/agent/process/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
