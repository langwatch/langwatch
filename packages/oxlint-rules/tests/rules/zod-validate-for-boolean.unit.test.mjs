import { afterAll, describe, expect, it } from "vitest";

import { zodValidateForBooleanRule } from "../../src/rules/zod-validate-for-boolean.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const filename = "modules/project/contract/src/example.contract.ts";
const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { contract: {} } } },
});
afterAll(() => workspace.cleanup());

function report(code, path = filename) {
  return runRule(zodValidateForBooleanRule, { code, cwd: workspace.cwd, filename: path });
}

describe("zod-validate-for-boolean", () => {
  describe("when a safeParse result is read only for its success flag", () => {
    /** @scenario "A success-only safeParse is reported with validate as the fix" */
    it.each([
      ["a condition", 'import { z } from "zod"; if (z.string().safeParse(value).success) run();'],
      ["a negation", "const ok = !schema.safeParse(input).success;"],
      ["an assertion", "expect(schema.safeParse(input).success).toBe(true);"],
      ["a multi-line call", "const ok = schema.safeParse({\n  id: 1,\n}).success;"],
      ["an awaited async parse", "const ok = (await schema.safeParseAsync(input)).success;"],
    ])("reports %s and names validate", (_name, code) => {
      const findings = report(code);
      expect(findings.map((finding) => finding.messageId)).toEqual(["useValidate"]);
      expect(findings[0].message).toMatch(/\.validate(Async)?\(/);
    });
  });

  describe("when the safeParse result is used beyond its flag", () => {
    /** @scenario "A safeParse whose data or error is read is left alone" */
    it.each([
      [
        "a kept result",
        "const result = schema.safeParse(input); if (result.success) use(result.data);",
      ],
      ["the data", "const data = schema.safeParse(input).data;"],
      ["the error", "const error = schema.safeParse(input).error;"],
      ["validate itself", "const ok = schema.validate(input);"],
      ["an un-awaited async parse", "const pending = schema.safeParseAsync(input).success;"],
    ])("leaves %s alone", (_name, code) => {
      expect(report(code)).toEqual([]);
    });
  });

  describe("when the file belongs to a published SDK", () => {
    /** @scenario "Published SDK sources are excluded from the validate check" */
    it("ignores it", () => {
      expect(
        report("const ok = schema.safeParse(input).success;", "sdks/typescript/src/example.ts"),
      ).toEqual([]);
    });
  });
});
