/**
 * The browser entry must import the global stylesheet, or none of it ships: the Inter `@font-face` `@import`, the link/box-sizing reset,
 * and every other rule in `styles/globals.scss` that the design-system theme tokens do not carry.
 * Spec: specs/ui/global-styles.feature
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const entrypoint = readFileSync(path.join(packageRoot, "src/ui.entrypoint.tsx"), "utf8");

describe("the browser entry's global stylesheet", () => {
  describe("when the entrypoint's imports are read", () => {
    /** @scenario The entrypoint imports the global stylesheet */
    it("imports ./styles/globals.scss", () => {
      expect(entrypoint).toMatch(/import\s+["']\.\/styles\/globals\.scss["'];?/);
    });

    it("names a stylesheet that actually exists in this package", () => {
      expect(existsSync(path.join(packageRoot, "src/styles/globals.scss"))).toBe(true);
    });
  });
});
