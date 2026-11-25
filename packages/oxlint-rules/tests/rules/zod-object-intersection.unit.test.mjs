import { afterAll, describe, expect, it } from "vitest";

import { zodObjectIntersectionRule } from "../../src/rules/zod-object-intersection.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const filename = "modules/project/contract/src/example.contract.ts";
const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { contract: {} } } },
  files: {
    "modules/project/contract/src/base.ts":
      'import { z } from "zod"; export const base = z.object({ id: z.string() });',
    "modules/project/contract/src/refined.ts":
      'import { z } from "zod"; export const refined = z.object({ id: z.string() }).refine(value => value.id.length > 0);',
  },
});
afterAll(() => workspace.cleanup());

function report(code, path = filename) {
  return runRule(zodObjectIntersectionRule, { code, cwd: workspace.cwd, filename: path });
}

describe("zod-object-intersection", () => {
  describe("when both sides of an intersection are plain Zod objects", () => {
    /** @scenario "Two plain objects intersected are reported with the shape spread" */
    it.each([
      [
        "and()",
        'import { z } from "zod"; const a = z.object({}); const b = z.object({}); a.and(b);',
      ],
      [
        "z.intersection()",
        'import { z } from "zod"; const a = z.object({}); z.intersection(a, z.object({}));',
      ],
      [
        "an imported object",
        'import { z } from "zod"; import { base } from "./base.ts"; base.and(z.object({ name: z.string() }));',
      ],
    ])("reports %s and names the shape spread", (_name, code) => {
      const findings = report(code);
      expect(findings.map((finding) => finding.messageId)).toEqual(["spreadShapes"]);
      expect(findings[0].message).toContain("z.object({ ...left.shape, ...right.shape })");
    });
  });

  describe("when only the left side carries refinements", () => {
    /** @scenario "A refined left side keeps its refinements" */
    it("directs the reader to safeExtend with the right side's shape", () => {
      const findings = report(
        'import { z } from "zod"; import { refined } from "./refined.ts"; refined.and(z.object({}));',
      );
      expect(findings.map((finding) => finding.messageId)).toEqual(["keepRefinements"]);
      expect(findings[0].message).toContain("left.safeExtend(right.shape)");
    });
  });

  describe("when the intersection cannot become one object", () => {
    /** @scenario "An intersection that cannot become one object is left alone" */
    it.each([
      [
        "an object with a record",
        'import { z } from "zod"; z.object({}).and(z.record(z.string(), z.any()));',
      ],
      [
        "a refined right side",
        'import { z } from "zod"; import { refined } from "./refined.ts"; z.object({}).and(refined);',
      ],
      [
        "a union",
        'import { z } from "zod"; z.intersection(z.object({}), z.union([z.object({}), z.object({})]));',
      ],
      [
        "an opaque schema",
        'import { z } from "zod"; import { a } from "elsewhere"; a.and(z.object({}));',
      ],
      ["an unrelated and()", "const guard = { and(x) { return x; } }; guard.and({});"],
    ])("leaves %s alone", (_name, code) => {
      expect(report(code)).toEqual([]);
    });
  });

  describe("when the file is a test or generated", () => {
    /** @scenario "Tests and generated files are excluded from the intersection check" */
    it.each(["example.generated.ts", "__tests__/example.unit.test.ts"])("ignores %s", (name) => {
      expect(
        report(
          'import { z } from "zod"; z.object({}).and(z.object({}));',
          `modules/project/contract/src/${name}`,
        ),
      ).toEqual([]);
    });
  });
});
