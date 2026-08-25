/**
 * `timeWindow.ts` names no other module, and this is what enforces it.
 *
 * The rule was a paragraph in that file's own docblock, which is exactly as
 * binding as the next person's willingness to read it. The module is imported
 * by two browser components — the schema browser and the time-window editor —
 * so a single edge added here is shipped to every member's browser: one import
 * of the sibling policy module pulls the handled errors and the remediation
 * registry along with it, and neither has any business in a bundle.
 *
 * Deliberately stricter than `src/server/__tests__/frontend-boundary.unit.test.ts`,
 * which follows only value imports because `import type` is erased. Here the
 * contract is *zero* imports, so a type-only edge is a violation too: it is the
 * first step of the drift, and there is nothing this module legitimately needs
 * to name.
 *
 * @see ../timeWindow.ts — the module under guard
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/lwql/__tests__` → `…/lwql` */
const MODULE_DIR = fileURLToPath(new URL("../", import.meta.url));

const read = (name: string): string => readFileSync(path.join(MODULE_DIR, name), "utf8");

/**
 * Every way a module can name another, in the order they are reported.
 *
 * The two static forms are anchored to the start of a line, because the guarded
 * module's docblock has to be able to use the words "import" and "importing" in
 * prose to explain the rule — a bare substring search would fail on the very
 * sentence that states it.
 */
const IMPORT_FORMS: readonly [form: string, pattern: RegExp][] = [
  ["a static import", /^\s*import\s/m],
  ["a re-export", /^\s*export\s[^;\n]*\bfrom\b/m],
  ["a dynamic import", /\bimport\s*\(/],
  ["a CommonJS require", /\brequire\s*\(/],
];

describe("the LangWatchQL time-window vocabulary", () => {
  describe("given the module both the server and the browser load", () => {
    it("names no other module, so importing it drags nothing along", () => {
      const source = read("timeWindow.ts");
      // The file is the one meant: a rename that emptied it would otherwise
      // pass this every time.
      expect(source).toContain("export function formatLangWatchQLDateTimeParameter");

      for (const [form, pattern] of IMPORT_FORMS) {
        expect(pattern.test(source), `timeWindow.ts contains ${form}`).toBe(false);
      }
    });
  });

  // Without these, the case above would pass just as happily against patterns
  // that had stopped matching anything at all.
  describe("given sources that do name another module", () => {
    it("recognises each form it is meant to catch", () => {
      const samples: Record<string, string> = {
        "a static import": 'import { a } from "./a";',
        "a re-export": 'export { a } from "./a";',
        "a dynamic import": 'const a = await import("./a");',
        "a CommonJS require": 'const a = require("./a");',
      };

      for (const [form, pattern] of IMPORT_FORMS) {
        expect(pattern.test(samples[form]!), form).toBe(true);
      }
    });

    it("reports the policy module next door, which really does import", () => {
      const source = read("resolveTimeWindow.ts");

      expect(IMPORT_FORMS.some(([, pattern]) => pattern.test(source))).toBe(true);
    });
  });
});
