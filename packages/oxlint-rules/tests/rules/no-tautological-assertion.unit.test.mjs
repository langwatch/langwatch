import { afterAll, describe, expect, it } from "vitest";

import { noTautologicalAssertionRule } from "../../src/rules/no-tautological-assertion.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const TEST = "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts";

function report(code, filename = TEST) {
  return runRule(noTautologicalAssertionRule, { code, cwd: workspace.cwd, filename });
}

describe("given a test file", () => {
  describe("when an assertion compares a literal or a variable with itself", () => {
    /** @scenario "An assertion that compares a value with itself is reported" */
    it("reports assertsItself on each assertion's line", () => {
      const found = report(
        [
          'it("runs", () => {',
          "  expect(true).toBe(true);",
          "  expect(result).toEqual(result);",
          "  expect(`x`).toStrictEqual(`x`);",
          "});",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.matcher])).toEqual([
        [2, "toBe"],
        [3, "toEqual"],
        [4, "toStrictEqual"],
      ]);
      expect(found[0].message).toBe(
        "`expect(true).toBe(true)` compares a value with itself and cannot fail." +
          " Assert the value the code produced against one derived independently of it.",
      );
    });
  });

  describe("when both sides call the code under test", () => {
    /** @scenario "A determinism check that calls the code twice is left alone" */
    it("reports nothing, because two calls can disagree", () => {
      const found = report(
        [
          "expect(hash(input)).toBe(hash(input));",
          "expect(client.teams).toBe(client.teams);",
          "expect(result).toBe(expected);",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a production file", () => {
  describe("when it spells the same assertion", () => {
    it("reports nothing", () => {
      expect(
        report("expect(true).toBe(true);", "modules/agent/process/src/services/agent.service.ts"),
      ).toEqual([]);
    });
  });
});
