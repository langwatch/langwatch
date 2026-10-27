/**
 * The design system's two package promises, read off the source and its
 * export map: it stays browser safe, and only declared entry points exist.
 * @vitest-environment node
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  exports: Record<string, string | { types: string; default: string }>;
};

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(entryPath);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [entryPath] : [];
  });
}

const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const FORBIDDEN: { name: string; matches: (specifier: string) => boolean }[] = [
  {
    name: "Node",
    matches: (s) => NODE_BUILTINS.has(s.split("/")[0] ?? s) || s.startsWith("node:"),
  },
  { name: "an app alias", matches: (s) => s.startsWith("~/") || s.startsWith("@/") },
  {
    name: "a router",
    matches: (s) => /^(react-router|@tanstack\/(react-)?router|next)(\/|$)/.test(s),
  },
  { name: "tRPC", matches: (s) => s.startsWith("@trpc/") },
  { name: "Prisma", matches: (s) => /^(@prisma\/|@langwatch\/prisma-client)/.test(s) },
  { name: "a server framework", matches: (s) => /^(hono|express|fastify)(\/|$)/.test(s) },
  {
    name: "an application or feature implementation",
    matches: (s) =>
      /^@langwatch\/(platform-api|ui|worker|tasks|server)(\/|$)/.test(s) ||
      /^@langwatch\/[a-z-]+-(process|browser|client|contract)(\/|$)/.test(s),
  },
];

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("the @langwatch/design-system package", () => {
  /** @scenario The design system is browser safe */
  it("imports no app alias, router, tRPC, Prisma, Node, server or feature implementation", () => {
    const files = productionSources(path.join(PACKAGE_ROOT, "src"));
    expect(files.length).toBeGreaterThan(0);

    const offences = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8")).flatMap((specifier) =>
        FORBIDDEN.filter(({ matches }) => matches(specifier)).map(
          ({ name }) => `${path.relative(PACKAGE_ROOT, file)} imports ${name}: ${specifier}`,
        ),
      ),
    );
    const declared = Object.keys(manifest.dependencies ?? {}).flatMap((dependency) =>
      FORBIDDEN.filter(({ matches }) => matches(dependency)).map(
        ({ name }) => `package.json depends on ${name}: ${dependency}`,
      ),
    );

    expect([...offences, ...declared]).toEqual([]);
  });

  /** @scenario Only deliberate component entry points are importable */
  it("exposes each entry point by name, each backed by a source file, and no wildcard", () => {
    const entries = Object.entries(manifest.exports);
    expect(entries.length).toBeGreaterThan(0);

    const wildcards = entries.filter(([name]) => name.includes("*")).map(([name]) => name);
    const missing = entries
      .filter(
        ([, target]) =>
          !existsSync(
            path.join(PACKAGE_ROOT, typeof target === "string" ? target : target.default),
          ),
      )
      .map(([name]) => name);

    expect(wildcards).toEqual([]);
    expect(missing).toEqual([]);
  });
});
