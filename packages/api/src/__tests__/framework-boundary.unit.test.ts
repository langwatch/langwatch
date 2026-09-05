/**
 * The framework's two structural promises, read off the source rather than
 * asserted in a review: nothing under `src` reaches product, enterprise or
 * persistence code, and the Hono half never learns about the tRPC half.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

const FORBIDDEN_SPECIFIER = [
  { name: "the platform application", pattern: /^@langwatch\/(platform-api|ui|worker)(?:\/|$)/ },
  {
    name: "a product feature implementation",
    pattern: /^@langwatch\/[a-z-]+-(server|web)(?:\/|$)/,
  },
  { name: "enterprise code", pattern: /^@langwatch\/enterprise(?:-|\/|$)/ },
  { name: "Prisma", pattern: /^(@prisma\/|@langwatch\/prisma-client)/ },
];

describe("the @langwatch/api package boundary", () => {
  const files = sourceFiles(sourceRoot).filter(
    (file) => !/(^|\/)__tests__(\/|$)|\.test\.tsx?$/.test(file),
  );

  describe("given every source file in the package", () => {
    /** @scenario "The package owns the framework and nothing else" */
    it("imports no platform application, product feature, enterprise or Prisma module", () => {
      expect(files.length).toBeGreaterThan(0);
      const offences = files.flatMap((file) =>
        importSpecifiers(file).flatMap((specifier) =>
          FORBIDDEN_SPECIFIER.filter(({ pattern }) => pattern.test(specifier)).map(
            ({ name }) => `${file.slice(packageRoot.length + 1)} imports ${name}: ${specifier}`,
          ),
        ),
      );

      expect(offences).toEqual([]);
    });

    /** @scenario "The package owns the framework and nothing else" */
    it("declares only portable contracts among its first-party runtime dependencies", () => {
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ) as Record<string, Record<string, string>>;
      const firstParty = Object.keys(manifest.dependencies ?? {}).filter((name) =>
        name.startsWith("@langwatch/"),
      );

      expect(firstParty.length).toBeGreaterThan(0);
      expect(
        firstParty.filter((name) => /-(server|web)$/.test(name) || name.includes("enterprise")),
      ).toEqual([]);
    });
  });

  describe("given the Hono half of the framework", () => {
    /** @scenario "tRPC remains a separate transport" */
    it("never reaches the tRPC root, so it can neither mount nor document it", () => {
      const restFiles = files.filter((file) => file.includes(`${join("src", "rest")}`));
      expect(restFiles.length).toBeGreaterThan(0);

      const offences = restFiles.flatMap((file) =>
        importSpecifiers(file)
          .filter(
            (specifier) => specifier.startsWith("@trpc") || /(^|\/)trpc(\/|$)/.test(specifier),
          )
          .map((specifier) => `${file.slice(packageRoot.length + 1)} imports ${specifier}`),
      );

      expect(offences).toEqual([]);
    });

    /** @scenario "tRPC remains a separate transport" */
    it("keeps the tRPC half free of the routing and documentation libraries", () => {
      const trpcFiles = files.filter((file) => file.includes(`${join("src", "trpc")}`));
      expect(trpcFiles.length).toBeGreaterThan(0);

      const offences = trpcFiles.flatMap((file) =>
        importSpecifiers(file)
          .filter((specifier) => specifier === "hono" || specifier.startsWith("hono-openapi"))
          .map((specifier) => `${file.slice(packageRoot.length + 1)} imports ${specifier}`),
      );

      expect(offences).toEqual([]);
    });
  });
});
