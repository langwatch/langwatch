import { afterAll, describe, expect, it } from "vitest";

import { testDescriptionIsAnActionRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/__tests__/agent.unit.test.ts") {
  return runRule(testDescriptionIsAnActionRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  describe('when an it title starts with "should"', () => {
    /** @scenario "A should-prefixed title is left to vitest/valid-title" */
    it("reports nothing, because the native rule owns titles", () => {
      expect(report('it("should check local first", () => {});')).toEqual([]);
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
    it("reports nestedDescribeMissingGivenWhen on the title", () => {
      const code = [
        'describe("AgentService", () => {',
        '  describe("submit behavior", () => {',
        '    it("does something", () => {});',
        "  });",
        "});",
      ].join("\n");

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ messageId: "nestedDescribeMissingGivenWhen", line: 2 });
    });
  });

  describe("when a nested describe is the table form describe.each(rows)(title)", () => {
    /** @scenario "A nested describe.each title missing given or when is a failure" */
    it("reports nestedDescribeMissingGivenWhen on the table's title", () => {
      const code = [
        'describe("AgentService", () => {',
        "  describe.each([[1], [2]])(",
        '    "submit %s",',
        "    () => {},",
        "  );",
        "});",
      ].join("\n");

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ messageId: "nestedDescribeMissingGivenWhen", line: 3 });
    });

    /** @scenario "A nested describe.each titled when is allowed" */
    it("reports nothing for a when title", () => {
      const code = `
        describe("AgentService", () => {
          describe.each([[1]])("when the request is %s", () => {});
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a describe nests inside a describe.each table", () => {
    /** @scenario "A describe inside a describe.each table is nested" */
    it("reports the inner title", () => {
      const code = [
        'describe.each([[1]])("AgentService %s", () => {',
        '  describe("submit behavior", () => {});',
        "});",
      ].join("\n");

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ messageId: "nestedDescribeMissingGivenWhen", line: 2 });
    });
  });

  describe("when a top-level describe has no given/when title", () => {
    /** @scenario "A top-level describe is exempt from given/when" */
    it("reports nothing", () => {
      expect(report('describe("AgentService", () => {});')).toEqual([]);
    });
  });

  describe('when a nested describe is titled "and "', () => {
    /** @scenario "An and-prefixed nested describe is left alone" */
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          describe("given a warm cache", () => {
            describe("and the cache is warm", () => {
              it("returns the cached value", () => {});
            });
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a nested describe names a method under test MDN-style", () => {
    /** @scenario "A nested describe naming the unit under test is left alone" */
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          describe("submitRequest()", () => {
            describe("when the request is valid", () => {
              it("returns the response", () => {});
            });
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a nested describe names a component under test MDN-style", () => {
    /** @scenario "A nested describe naming a component under test is left alone" */
    it("reports nothing", () => {
      const code = `
        describe("<DatePicker/>", () => {
          describe("useFeatureFlag()", () => {
            describe("when the flag is enabled", () => {
              it("returns true", () => {});
            });
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a nested describe title is a capitalized phrase, not a unit name", () => {
    /** @scenario "A capitalized phrase is still a failure, not a unit name" */
    it("reports nestedDescribeMissingGivenWhen", () => {
      const code = [
        'describe("AgentService", () => {',
        '  describe("Basic rendering", () => {',
        '    it("does something", () => {});',
        "  });",
        "});",
      ].join("\n");

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ messageId: "nestedDescribeMissingGivenWhen", line: 2 });
    });
  });

  describe("when the file is not a *.test.ts file", () => {
    /** @scenario "A nested describe outside a test file is not governed" */
    it("reports nothing", () => {
      const code = 'describe("AgentService", () => { describe("submit behavior", () => {}); });';

      expect(report(code, "modules/agent/process/src/agent.service.ts")).toEqual([]);
    });
  });
});
