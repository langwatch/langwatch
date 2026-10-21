/**
 * The catalogue is composed by the application, not by Eventing: nothing in
 * this package may name an application, a product feature or enterprise code,
 * which is what lets a host install whichever pipelines it owns.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
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

  describe("given the import graph walked from the root entry", () => {
    /** @scenario "The root entry never reaches the server tier" */
    it("reaches no server, Prisma or ClickHouse file or client", () => {
      const reached = walkFrom(join(sourceRoot, "index.ts"));
      expect(reached.files.length).toBeGreaterThan(10);

      const offences = [
        ...reached.files
          .filter((file) => TIER_PATH.test(relative(sourceRoot, file)))
          .map((file) => `${relative(packageRoot, file)} is reached from index.ts`),
        ...reached.externals.filter(({ specifier }) => TIER_CLIENT.test(specifier)),
      ].map((offence) =>
        typeof offence === "string" ? offence : `${offence.from} imports ${offence.specifier}`,
      );

      expect(offences).toEqual([]);
    });

    it("recognises a server file when one is reached", () => {
      expect(TIER_PATH.test("server/index.ts")).toBe(true);
      expect(TIER_PATH.test("repositories/prisma/x.ts")).toBe(true);
      expect(TIER_PATH.test("repositories/clickhouse/x.ts")).toBe(true);
      expect(TIER_PATH.test("stores/repositories/eventRepositoryMemory.ts")).toBe(false);
      expect(TIER_CLIENT.test("@prisma/client")).toBe(true);
      expect(TIER_CLIENT.test("@clickhouse/client")).toBe(true);
      expect(TIER_CLIENT.test("@langwatch/prisma-client")).toBe(true);
      expect(TIER_CLIENT.test("@langwatch/clickhouse-client")).toBe(true);
    });
  });
});

const TIER_PATH = /(^|\/)(server|repositories\/(prisma|clickhouse))\//;
const TIER_CLIENT =
  /^@(?:(?:prisma|clickhouse)\/client|langwatch\/(?:prisma|clickhouse)-client)(\/|$)/;

function specifiersOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  const stem = base.replace(/\.(?:js|ts)$/, "");
  return [base, `${stem}.ts`, join(base, "index.ts")].find(
    (candidate) => candidate.endsWith(".ts") && existsSync(candidate),
  );
}

function walkFrom(entry: string): {
  files: string[];
  externals: { from: string; specifier: string }[];
} {
  const seen = new Set<string>();
  const externals: { from: string; specifier: string }[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        externals.push({ from: relative(packageRoot, file), specifier });
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (target) queue.push(target);
    }
  }
  return { files: [...seen], externals };
}
