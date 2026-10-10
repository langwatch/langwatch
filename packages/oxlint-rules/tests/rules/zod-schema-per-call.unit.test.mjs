import { afterAll, describe, expect, it } from "vitest";

import { zodSchemaPerCallRule } from "../../src/rules/zod-schema-per-call.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const filename = "modules/project/process/src/repositories/prisma/prisma.project.repository.ts";
const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { server: {} } } },
  files: {
    "modules/project/contract/src/project.ts":
      'import { z } from "zod"; export const projectSchema = z.object({ id: z.string(), name: z.string() });',
  },
});
afterAll(() => workspace.cleanup());

function report(code, path = filename) {
  return runRule(zodSchemaPerCallRule, { code, cwd: workspace.cwd, filename: path });
}

describe("zod-schema-per-call", () => {
  describe("when a schema is built inside an iteration", () => {
    /** @scenario "A schema built inside an iteration is reported once" */
    it.each([
      [
        "a map callback in a function",
        'import { z } from "zod"; export function read(rows) { return rows.map((row) => z.object({ id: z.string() }).parse(row)); }',
        "z.object()",
      ],
      [
        "a record in a for-of loop",
        'import { z } from "zod"; export function read(rows) { for (const row of rows) z.record(z.string(), z.string()).parse(row); }',
        "z.record()",
      ],
      [
        "a pick of an imported object",
        'import { projectSchema } from "../../../../contract/src/project.ts"; export function read(rows) { return rows.map((row) => projectSchema.pick({ id: true }).parse(row)); }',
        ".pick()",
      ],
    ])("reports %s once, at the outermost construction", (_name, code, call) => {
      const findings = report(code);
      expect(findings.map((finding) => finding.messageId)).toEqual(["perIteration"]);
      expect(findings[0].message).toContain(`\`${call}\``);
    });
  });

  describe("when a schema is built inside a class method", () => {
    /** @scenario "A schema built inside a class method is reported" */
    it.each([
      [
        "a method",
        'import { z } from "zod"; export class Repo { find(rows) { return z.array(z.object({ id: z.string() })).parse(rows); } }',
      ],
      [
        "a method that returns the parse result",
        'import { z } from "zod"; export class Repo { find(rows) { return z.array(z.string()).parse(rows); } }',
      ],
      [
        "an arrow-function property",
        'import { projectSchema } from "../../../../contract/src/project.ts"; export class Service { list = (input) => projectSchema.omit({ name: true }).parse(input); }',
      ],
    ])("reports %s", (_name, code) => {
      const findings = report(code);
      expect(findings.map((finding) => finding.messageId)).toEqual(["perCall"]);
    });
  });

  describe("when the schema is built once", () => {
    /** @scenario "A schema built once is left alone" */
    it.each([
      [
        "at module scope",
        'import { z } from "zod"; export const row = z.object({ id: z.string() });',
      ],
      [
        "in a module-scope map",
        'import { z } from "zod"; export const rows = ["a", "b"].map((name) => z.object({ [name]: z.string() }));',
      ],
      [
        "in a factory function",
        'import { z } from "zod"; export function command(shape) { return z.object({ id: z.string(), ...shape }); }',
      ],
      [
        "by a method that returns it",
        'import { z } from "zod"; export class Filters { repeatable(inner) { return z.union([inner, z.array(inner).max(5)]).transform((v) => [v]); } }',
      ],
      [
        "by an arrow method that returns it",
        'import { z } from "zod"; export class Filters { list = (inner) => z.array(inner).optional(); }',
      ],
      [
        "in a static field",
        'import { z } from "zod"; export class Repo { static row = z.object({ id: z.string() }); }',
      ],
      [
        "as a parse of a hoisted schema",
        'import { z } from "zod"; const row = z.object({ id: z.string() }); export class Repo { find(rows) { return rows.map((r) => row.parse(r)); } }',
      ],
      [
        "as an unrelated pick",
        "export class Repo { find(rows, picker) { return rows.map((row) => picker.pick({ id: true })); } }",
      ],
    ])("leaves a schema built %s alone", (_name, code) => {
      expect(report(code)).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "Tests are excluded from the per-call check" */
    it("ignores it", () => {
      expect(
        report(
          'import { z } from "zod"; export function read(rows) { return rows.map((row) => z.object({}).parse(row)); }',
          "modules/project/process/src/__tests__/read.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
