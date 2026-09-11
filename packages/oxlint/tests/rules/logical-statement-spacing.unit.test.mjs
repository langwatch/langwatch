import { afterAll, describe, expect, it } from "vitest";
import { logicalStatementSpacingRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(logicalStatementSpacingRule, { code, cwd: workspace.cwd, filename: "x.ts" });
}

describe("given a function body", () => {
  describe("when a statement follows an if with no blank line", () => {
    /** @scenario "A statement crowding a control-flow block is reported and fixed" */
    it("reports statementSpacing", () => {
      const found = report(
        "export function f(a) {\n  if (a) {\n    return 1;\n  }\n  return 2;\n}",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("statementSpacing");
    });
  });

  describe("when a blank line already separates them", () => {
    /** @scenario "A blank line after control flow satisfies the rule" */
    it("reports nothing", () => {
      expect(
        report("export function f(a) {\n  if (a) {\n    return 1;\n  }\n\n  return 2;\n}"),
      ).toEqual([]);
    });
  });

  describe("when a statement spanning several lines is crowded", () => {
    const crowded = [
      "export async function f(db) {",
      "  const rows = await db.find({",
      "    where: { a: 1 },",
      "  });",
      "  const ids = rows.map((row) => row.id);",
      "  if (ids.length === 0) return [];",
      "  const counts = await db.count({",
      "    where: { id: { in: ids } },",
      "  });",
      "",
      "  return counts;",
      "}",
    ].join("\n");

    /** @scenario "A multi-line statement stands as its own paragraph" */
    it("reports paragraphSpacing on each side of the multi-line statement", () => {
      const found = report(crowded);

      expect(found.map((item) => [item.messageId, item.line])).toEqual([
        ["paragraphSpacing", 5],
        ["statementSpacing", 7],
      ]);
    });

    /** @scenario "A multi-line statement stands as its own paragraph" */
    it("leaves a single-line declaration and its guard together", () => {
      const found = report(
        "export function f(rows) {\n  const ids = rows.map((row) => row.id);\n  if (ids.length === 0) return [];\n\n  return ids;\n}",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a chain repeats a group opener without a blank line", () => {
    const chain = [
      "export const t = define(Api)",
      '  .procedure("a")',
      '  .withPermission("p")',
      "  .handle(async ({ app }) => app.a())",
      '  .procedure("b")',
      '  .withPermission("p")',
      "  .handle(async ({ app }) => app.b())",
      "  .build();",
    ].join("\n");

    /** @scenario "Groups in a builder chain are separated" */
    it("reports chainGroupSpacing before the second opener only", () => {
      const found = report(chain);

      expect(found.map((item) => [item.messageId, item.line])).toEqual([
        ["chainGroupSpacing", 5],
      ]);
    });

    /** @scenario "Groups in a builder chain are separated" */
    it("accepts a chain whose groups are already separated", () => {
      const separated = chain.replace('\n  .procedure("b")', '\n\n  .procedure("b")');

      expect(report(separated)).toEqual([]);
    });

    /** @scenario "Groups in a builder chain are separated" */
    it("ignores a chain that fits on one line", () => {
      expect(report('export const x = a.get("/").get("/b").build();')).toEqual([]);
    });
  });
});
