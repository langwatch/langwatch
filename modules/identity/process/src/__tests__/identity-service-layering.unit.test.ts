import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const IDENTITY_SRC = join(ROOT, "modules/identity/process/src");
const AUTH_SRC = join(ROOT, "modules/auth/process/src");
const BETTER_AUTH_CHANNELS = join(AUTH_SRC, "channels/http");
const PRISMA_CLIENTS = new Set(["@prisma/client", "@langwatch/prisma-client"]);
/** Services that build their own helper services today. The list only shrinks:
 *  a new entry is a regression, and a fixed one must leave the list. */
const COMPOSITION_RESIDUALS = new Set([
  "modules/identity/process/src/services/identity-write-gate.service.ts",
  "modules/identity/process/src/services/join-requests.service.ts",
  "modules/identity/process/src/services/sso-connection-guards.service.ts",
]);

function sourcesUnder(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts"))
    .filter((entry) => !entry.split("/").includes("__tests__"))
    .map((entry) => join(dir, entry))
    .map((path) => ({ path: relative(ROOT, path), source: readFileSync(path, "utf8") }));
}

function valueImportsOf(source: string): string[] {
  const statements = source.matchAll(/^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm);
  return [...statements]
    .filter(([, clause]) => !clause!.startsWith("type ") && !isTypeOnlyBraces(clause!))
    .map(([, , specifier]) => specifier!);
}

function isTypeOnlyBraces(clause: string): boolean {
  const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
  if (!braces) return false;
  const names = braces[1]!
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.every((name) => name.startsWith("type "));
}

const importsAPrismaClient = (source: string) =>
  valueImportsOf(source).some((specifier) => PRISMA_CLIENTS.has(specifier));

const inRepositoryTier = (path: string) => path.includes("/repositories/prisma/");

const betterAuthChannels = () =>
  sourcesUnder(BETTER_AUTH_CHANNELS).filter(({ path }) =>
    /\/http\.better-auth[^/]*\.channel\.ts$/.test(path),
  );

const identityAndAuth = () => [...sourcesUnder(IDENTITY_SRC), ...sourcesUnder(AUTH_SRC)];

describe("the auth boundary over identity services", () => {
  /** @scenario "better-auth never opens the database itself" */
  it("finds better-auth channels, and none imports a Prisma client for its value", () => {
    const channels = betterAuthChannels();

    expect(channels.length).toBeGreaterThan(0);
    expect(
      channels.filter(({ source }) => importsAPrismaClient(source)).map(({ path }) => path),
    ).toEqual([]);
  });

  /** @scenario "Prisma is spelled in the repository tier only" */
  it("imports a Prisma client for its value only under repositories/prisma", () => {
    const offenders = identityAndAuth()
      .filter(({ path }) => !inRepositoryTier(path))
      .filter(({ source }) => importsAPrismaClient(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  /** @scenario "The identity services are composed in one file" */
  it("constructs services only in the module's app folder and eventing pipelines", () => {
    const constructing = sourcesUnder(IDENTITY_SRC)
      .filter(
        ({ path }) => !path.includes("/src/app/") && !/\/eventing\/[^/]+\.pipeline\.ts$/.test(path),
      )
      .filter(({ source }) => /\b[A-Z]\w*Service\.create\(/.test(source))
      .map(({ path }) => path);

    expect(constructing.filter((path) => !COMPOSITION_RESIDUALS.has(path))).toEqual([]);
    expect([...COMPOSITION_RESIDUALS].filter((path) => !constructing.includes(path))).toEqual([]);
  });

  /** @scenario "A question about the data is asked in one place" */
  it("spells a case-insensitive database match only in the repository tier", () => {
    const offenders = identityAndAuth()
      .filter(({ path }) => !inRepositoryTier(path))
      .filter(({ source }) => /mode:\s*["']insensitive["']/.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  /** @scenario "better-auth keeps no state of its own" */
  it("holds no module-scope mutable binding in a better-auth channel", () => {
    const offenders = betterAuthChannels()
      .filter(({ source }) => /^(?:export\s+)?(?:let|var)\s/m.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
