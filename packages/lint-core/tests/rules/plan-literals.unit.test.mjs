import { afterAll, describe, expect, it } from "vitest";
import { planLiteralsRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const BASELINED = "enterprise/modules/billing/contract/src/plan-limits.ts";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
  files: {
    "packages/architecture-lint/src/oxlint-baseline.json": JSON.stringify({
      version: 0,
      entries: [{ key: `plan-literals|${BASELINED}`, measured: "2026-09-07" }],
    }),
  },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";

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
          "modules/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file carries a baseline entry", () => {
    /** @scenario "A file on the debt register is left alone" */
    it("reports nothing", () => {
      expect(ids("const plan = { maxMembers: 2, canPublish: true };", BASELINED)).toEqual([]);
    });
  });
});
