/**
 * Ensures `analytics.lwql-time-window.ts` has zero imports—it's loaded by
 * browsers and must stay bundle-clean.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/contract/src/__tests__` → `…/contract/src` */
const MODULE_DIR = fileURLToPath(new URL("../", import.meta.url));

const read = (name: string): string => readFileSync(path.join(MODULE_DIR, name), "utf8");

/**
 * Every way a module can name another, in the order they are reported. The
 * static forms anchor to a line start, since the guarded module's own
 * docblock uses the words "import"/"importing" in prose.
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
      const source = read("analytics.lwql-time-window.ts");
      // The file is the one meant: a rename that emptied it would otherwise
      // pass this every time.
      expect(source).toContain("export function formatLangWatchQLDateTimeParameter");

      for (const [form, pattern] of IMPORT_FORMS) {
        expect(pattern.test(source), `analytics.lwql-time-window.ts contains ${form}`).toBe(false);
      }
    });
  });

  // Without these, the case above would pass just as happily against patterns
  // that had stopped matching anything at all.
  describe("given sources that do name another module", () => {
    it("recognises each form it is meant to catch", () => {
      const samples: Record<string, string> = {
        "a static import": 'import { a } from "@langwatch/trace-server";',
        "a re-export": 'export { a } from "./a";',
        "a dynamic import": 'const a = await import("./a");',
        "a CommonJS require": 'const a = require("./a");',
      };

      for (const [form, pattern] of IMPORT_FORMS) {
        expect(pattern.test(samples[form]!), form).toBe(true);
      }
    });

    it("reports a sibling contract module, which really does import", () => {
      const source = read("analytics.service.ts");

      expect(IMPORT_FORMS.some(([, pattern]) => pattern.test(source))).toBe(true);
    });
  });
});
