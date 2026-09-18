/**
 * None of `styles/globals.scss` ships unless the browser entry imports it, and a
 * cut it does not declare is one the browser synthesises.
 * Spec: specs/ui/global-styles.feature
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const entrypoint = readFileSync(path.join(packageRoot, "src/main.tsx"), "utf8");
const globalStylesheet = readFileSync(path.join(packageRoot, "src/styles/globals.scss"), "utf8");

/** The display-face files the application actually ships, as the browser would ask for them. */
const vendoredDisplayFaces = readdirSync(path.join(packageRoot, "public/fonts"))
  .filter((file) => file.startsWith("Sentient-") && file.endsWith(".woff2"))
  .toSorted();

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

  describe("when the display face's vendored cuts are compared with what it declares", () => {
    /** @scenario Every vendored cut of the display face is declared document-wide */
    it("declares a face for every vendored cut", () => {
      const declared = vendoredDisplayFaces.filter((file) =>
        globalStylesheet.includes(`/fonts/${file}`),
      );

      expect(declared).toEqual(vendoredDisplayFaces);
    });

    it("declares a real bold cut, so a semibold heading is not synthesised from Medium", () => {
      expect(globalStylesheet).toMatch(
        /@font-face\s*\{[^}]*Sentient-Bold\.woff2[^}]*font-weight:\s*700/,
      );
    });
  });
});
