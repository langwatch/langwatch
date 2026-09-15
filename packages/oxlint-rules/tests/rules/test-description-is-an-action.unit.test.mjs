import { afterAll, describe, expect, it } from "vitest";
import { testDescriptionIsAnActionRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/server/src/__tests__/agent.unit.test.ts") {
  return runRule(testDescriptionIsAnActionRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  describe("when an it title starts with \"should\"", () => {
    /** @scenario "A should-prefixed it title is a failure" */
    it("reports titleStartsWithShould", () => {
      const found = report('it("should check local first", () => {});');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("titleStartsWithShould");
    });
  });

  describe("when a test title starts with \"Should\"", () => {
    /** @scenario "A Should-prefixed test title is a failure regardless of case" */
    it("reports titleStartsWithShould", () => {
      const found = report('test("Should check local first", () => {});');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("titleStartsWithShould");
    });
  });

  describe("when an it title is an action", () => {
    /** @scenario "An action-phrased it title is allowed" */
    it("reports nothing", () => {
      expect(report('it("checks local first", () => {});')).toEqual([]);
    });
  });

  describe("when a describe is nested inside another describe with a given/when title", () => {
    /** @scenario "A nested describe titled given or when is allowed" */
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          describe("given a warm cache", () => {
            describe("when the cache hits", () => {
              it("returns the cached value", () => {});
            });
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a describe is nested inside another describe without a given/when title", () => {
    /** @scenario "A nested describe missing given or when is a failure" */
    it("reports nestedDescribeMissingGivenWhen", () => {
      const code = `
        describe("AgentService", () => {
          describe("submit behavior", () => {
            it("does something", () => {});
          });
        });
      `;

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("nestedDescribeMissingGivenWhen");
    });
  });

  describe("when a top-level describe has no given/when title", () => {
    /** @scenario "A top-level describe is exempt from given/when" */
    it("reports nothing", () => {
      expect(report('describe("AgentService", () => {});')).toEqual([]);
    });
  });

  describe("when the file is not a *.test.ts file", () => {
    /** @scenario "A should-prefixed title outside a test file is not governed" */
    it("reports nothing", () => {
      expect(
        report('it("should check local first", () => {});', "modules/agent/server/src/agent.service.ts"),
      ).toEqual([]);
    });
  });
});
