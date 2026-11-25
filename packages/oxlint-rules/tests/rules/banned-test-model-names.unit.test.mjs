import { afterAll, describe, expect, it } from "vitest";

import { bannedTestModelNamesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, expectFix, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const filename = "modules/agent/process/src/__tests__/agent.unit.test.ts";

function report(code, file = filename) {
  return runRule(bannedTestModelNamesRule, { code, cwd: workspace.cwd, filename: file });
}

function fix(code, output, { errors = 1, file = filename } = {}) {
  expectFix(bannedTestModelNamesRule, { code, cwd: workspace.cwd, errors, filename: file, output });
}

describe("given a test file", () => {
  describe("when a string literal names gpt-4o", () => {
    /** @scenario "A gpt-4o literal in a test is a failure" */
    it("reports bannedModelName", () => {
      const found = report('const model = "openai/gpt-4o";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bannedModelName");
      expect(found[0].data.name).toBe("gpt-4o");
    });
  });

  describe("when a string literal names gpt-4o-mini", () => {
    /** @scenario "A gpt-4o-mini literal is reported under its own name" */
    it("reports bannedModelName for gpt-4o-mini, not gpt-4o", () => {
      const found = report('const model = "gpt-4o-mini";');

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-4o-mini");
    });
  });

  describe("when a string literal names gpt-3.5-turbo", () => {
    /** @scenario "A gpt-3.5-turbo literal in a fixture is a failure" */
    it("reports bannedModelName", () => {
      const found = report(
        'export const fixture = { model: "gpt-3.5-turbo" };',
        "modules/agent/process/src/__tests__/agent.fixture.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-3.5-turbo");
    });
  });

  describe("when a string literal names the allowed model", () => {
    /** @scenario "A gpt-5-mini literal is allowed" */
    it("reports nothing", () => {
      expect(report('const model = "gpt-5-mini";')).toEqual([]);
    });
  });

  describe("when the file is production source, not a test", () => {
    /** @scenario "A provider catalogue in production source is not governed" */
    it("reports nothing", () => {
      expect(
        report('const model = "gpt-4o";', "modules/model-provider/process/src/model-catalog.ts"),
      ).toEqual([]);
    });
  });

  describe("when a bare literal names a banned model", () => {
    /** @scenario "A banned model literal is rewritten to gpt-5-mini" */
    it("rewrites the literal to gpt-5-mini", () => {
      expect(() => fix('const model = "gpt-4o";', 'const model = "gpt-5-mini";')).not.toThrow();
    });
  });

  describe("when the banned name sits inside a longer string", () => {
    /** @scenario "A banned model name inside a longer string is rewritten in place" */
    it("replaces only the matched substring", () => {
      expect(() =>
        fix(
          'const note = "model: gpt-4.1-mini, temp 0";',
          'const note = "model: gpt-5-mini, temp 0";',
        ),
      ).not.toThrow();
    });
  });

  describe("when two different banned names sit in one literal", () => {
    /** @scenario "Two banned names in one literal are both rewritten" */
    it("reports and fixes both occurrences", () => {
      const code = 'const note = "gpt-4o then gpt-4.1-mini";';
      const found = report(code);

      expect(found).toHaveLength(2);
      expect(found.map((entry) => entry.data.name)).toEqual(["gpt-4o", "gpt-4.1-mini"]);

      fix(code, 'const note = "gpt-5-mini then gpt-5-mini";', { errors: 2 });
    });
  });

  describe("when a template literal quasi names a banned model", () => {
    /** @scenario "A template literal naming a banned model is rewritten" */
    it("rewrites the quasi in place", () => {
      expect(() =>
        fix("const model = `openai/gpt-4o`;", "const model = `openai/gpt-5-mini`;"),
      ).not.toThrow();
    });
  });

  describe("when the banned name sits in a quasi after an interpolation", () => {
    /** @scenario "A template literal interpolation next to a banned name is left untouched" */
    it("rewrites only the literal text, not the interpolated expression", () => {
      expect(() =>
        fix("const model = `${provider}/gpt-4o`;", "const model = `${provider}/gpt-5-mini`;"),
      ).not.toThrow();
    });
  });

  describe("when the fixed source is linted again", () => {
    /** @scenario "The rewritten literal reports nothing" */
    it("reports nothing", () => {
      expect(report('const note = "gpt-5-mini then gpt-5-mini";')).toEqual([]);
      expect(report("const model = `${provider}/gpt-5-mini`;")).toEqual([]);
    });
  });

  describe("when the matched text has no word boundary around it", () => {
    /** @scenario "A model name with no word boundary is left alone" */
    it("does not report at all", () => {
      const code = 'const model = "gpt-4omega";';

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the banned name is the prefix of a dated model id", () => {
    /** @scenario "A dated model id is a different model and is left alone" */
    it("neither reports nor rewrites it", () => {
      const code = 'const model = "gpt-4o-2024-08-06"; const other = "openai/gpt-4.1.2";';

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a banned name ends a sentence", () => {
    /** @scenario "A banned name before a closing period is still reported" */
    it("reports the name on its line", () => {
      const found = report('const note = "we used gpt-4o.";');

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-4o");
      expect(found[0].line).toBe(1);
    });
  });

  describe("when the banned name anchors a regex matching pattern", () => {
    /** @scenario "A banned model name inside a regex pattern is reported without a rewrite" */
    it("reports the literal but declines to fix it", () => {
      const code = 'const cost = { regex: "^(openai\\\\/)?gpt-4o$" };';
      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-4o");

      fix(code, null);
    });
  });
});

describe("given a test inside modules/model-provider", () => {
  const catalogueTest = "modules/model-provider/contract/src/__tests__/model-cost.unit.test.ts";

  describe("when the model name is the value under test", () => {
    /** @scenario "The model catalogue's own tests may name real models" */
    it("reports nothing", () => {
      expect(report('expect(normalizeModelName("GPT-4O")).toBe("gpt-4o");', catalogueTest)).toEqual(
        [],
      );
      expect(
        report(
          'const row = { model: "openai/gpt-4o", inputCostPerToken: 0.0000025 };',
          catalogueTest,
        ),
      ).toEqual([]);
      expect(
        report('expect(normalizeModelName("gpt-4o-fp8")).toBe("gpt-4o");', catalogueTest),
      ).toEqual([]);
    });
  });

  describe("when the same literal sits in any other module", () => {
    /** @scenario "The exemption is the catalogue's alone" */
    it("still reports it", () => {
      const elsewhere = "modules/agent/process/src/__tests__/agent.unit.test.ts";

      expect(report('const model = "openai/gpt-4o";', elsewhere)).toHaveLength(1);
    });
  });
});
