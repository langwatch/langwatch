import { afterAll, describe, expect, it } from "vitest";
import { bannedTestModelNamesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(bannedTestModelNamesRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  const filename = "modules/agent/server/src/__tests__/agent.unit.test.ts";

  describe("when a string literal names gpt-4o", () => {
    /** @scenario "A gpt-4o literal in a test is a failure" */
    it("reports bannedModelName", () => {
      const found = report('const model = "openai/gpt-4o";', filename);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bannedModelName");
      expect(found[0].data.name).toBe("gpt-4o");
    });
  });

  describe("when a string literal names gpt-4o-mini", () => {
    /** @scenario "A gpt-4o-mini literal is reported under its own name" */
    it("reports bannedModelName for gpt-4o-mini, not gpt-4o", () => {
      const found = report('const model = "gpt-4o-mini";', filename);

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-4o-mini");
    });
  });

  describe("when a string literal names gpt-3.5-turbo", () => {
    /** @scenario "A gpt-3.5-turbo literal in a fixture is a failure" */
    it("reports bannedModelName", () => {
      const found = report(
        'export const fixture = { model: "gpt-3.5-turbo" };',
        "modules/agent/server/src/__tests__/agent.fixture.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("gpt-3.5-turbo");
    });
  });

  describe("when a string literal names the allowed model", () => {
    /** @scenario "A gpt-5-mini literal is allowed" */
    it("reports nothing", () => {
      expect(report('const model = "gpt-5-mini";', filename)).toEqual([]);
    });
  });

  describe("when the file is production source, not a test", () => {
    /** @scenario "A provider catalogue in production source is not governed" */
    it("reports nothing", () => {
      expect(
        report('const model = "gpt-4o";', "modules/model-provider/server/src/model-catalog.ts"),
      ).toEqual([]);
    });
  });
});
