/**
 * The catalogue is composed by the application, not by Eventing: nothing in
 * this package may name an application, a product feature or enterprise code,
 * which is what lets a host install whichever pipelines it owns.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
    if (!/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

const FORBIDDEN = [
  { name: "the platform applications", pattern: /^@langwatch\/(platform-api|worker|ui)(?:\/|$)/ },
  {
    name: "a product feature package",
    pattern: /^@langwatch\/[a-z-]+-(contract|server|web)(?:\/|$)/,
  },
  { name: "enterprise code", pattern: /^@langwatch\/enterprise(?:-|\/|$)/ },
];

describe("the @langwatch/eventing package boundary", () => {
  describe("given every production source file in the package", () => {
    /** @scenario "The application composes an explicit event catalogue" */
    it("names no application, product feature or enterprise module", () => {
      const files = productionSources(sourceRoot);
      expect(files.length).toBeGreaterThan(0);

      const offences = files.flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
          (match) => match[1] ?? "",
        );
        return specifiers.flatMap((specifier) =>
          FORBIDDEN.filter(({ pattern }) => pattern.test(specifier)).map(
            ({ name }) => `${file.slice(packageRoot.length + 1)} imports ${name}: ${specifier}`,
          ),
        );
      });

      expect(offences).toEqual([]);
    });
  });
});
