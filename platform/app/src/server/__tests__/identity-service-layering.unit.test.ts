import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-129's tiers as graph facts (specs/identity/identity-service-layering.feature).
 *
 * A plain text scan over the sources, in the same spirit as
 * identity-package-boundaries.unit.test.ts: an import is a line, a query is
 * a line, a `new FooService(` is a line, and the test that reads the same
 * lines a reviewer would is the one that keeps saying the same thing. Each
 * assertion lists its offenders by file, so tightening a rule later is a
 * regex edit and a read of the list.
 */

const APP_SRC = join(__dirname, "..", "..");
const SERVER = join(APP_SRC, "server");
const BETTER_AUTH = join(SERVER, "better-auth");
const IDENTITY = join(SERVER, "app-layer", "identity");
const RUNTIME = join(IDENTITY, "runtime.ts");

/** The boundary files that turn a request into a call on an identity service. */
const AUTH_BOUNDARY_FILES = [
  join(SERVER, "api", "routers", "auth.ts"),
  join(SERVER, "api", "routers", "user.ts"),
  join(SERVER, "routes", "auth.ts"),
];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "__tests__" && entry !== "node_modules") walk(path);
        continue;
      }
      if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) files.push(path);
    }
  };
  walk(root);
  return files;
}

const rel = (file: string) => relative(APP_SRC, file).split("\\").join("/");

const read = (file: string) => readFileSync(file, "utf8");

/** Value imports only: `import type` is erased and reaches nothing. */
function valueImportSpecifiers(file: string): string[] {
  return [
    ...read(file).matchAll(
      /^\s*(?:import|export)\s(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm,
    ),
  ].map((match) => match[1] as string);
}

/**
 * A file in the repository tier: it may spell a query, a key scheme, a
 * case-insensitive match. Everything else asks one of these.
 */
const isRepositoryTier = (file: string) =>
  rel(file).includes("/repositories/") ||
  /\.(?:repository|adapter)\.ts$/.test(file) ||
  /-adapters\.ts$/.test(file);

/** `prisma.user.findFirst(`, `tx.account.update(`, `prisma.$transaction(` — a query. */
const QUERY =
  /\b(?:prisma|tx)\.(?:\$transaction|\$queryRaw|\$executeRaw|[a-z][A-Za-z]*\.(?:find|count|create|update|upsert|delete|aggregate|group))/;

const offendersOf = (
  files: string[],
  test: (file: string, source: string) => string[],
): string[] =>
  files.flatMap((file) =>
    test(file, read(file)).map((why) => `${rel(file)}: ${why}`),
  );

describe("identity service layering", () => {
  describe("when the better-auth sources are scanned for imports", () => {
    /** @scenario "better-auth never opens the database itself" */
    it("import no database client for its value", () => {
      const offenders = offendersOf(sourceFiles(BETTER_AUTH), (file) =>
        valueImportSpecifiers(file).filter(
          (specifier) =>
            specifier === "~/server/db" ||
            /^@prisma\/client/.test(specifier) ||
            /^\.prisma\//.test(specifier) ||
            /prisma\/client/.test(specifier),
        ),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("when the identity trees are scanned for queries", () => {
    /** @scenario "Prisma is spelled in the repository tier only" */
    it("query only from a repository or adapter file", () => {
      const files = [...sourceFiles(BETTER_AUTH), ...sourceFiles(IDENTITY)];
      const offenders = offendersOf(files, (file, source) =>
        isRepositoryTier(file)
          ? []
          : source
              .split("\n")
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => QUERY.test(line))
              .map(({ line, index }) => `L${index + 1} ${line.trim()}`),
      );
      // The composition root holds the client to construct repositories; a
      // query in it is the same violation as a query anywhere else.
      expect(offenders).toEqual([]);
    });

    /** @scenario "Prisma is spelled in the repository tier only" */
    it("keep the auth routers and route off the account, session, passkey, verification and SSO rows", () => {
      const AUTH_ROW =
        /\bprisma\.(?:account|session|passkey|verification|ssoProvider|ssoConnection|twoFactor)\.(?:find|count|create|update|upsert|delete)/;
      const offenders = offendersOf(AUTH_BOUNDARY_FILES, (_file, source) =>
        source
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => AUTH_ROW.test(line))
          .map(({ line, index }) => `L${index + 1} ${line.trim()}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("when every construction in the identity trees is located", () => {
    /** @scenario "The identity services are composed in one file" */
    it("construct services, Prisma repositories and ledger writers only in runtime.ts", () => {
      const CONSTRUCTION =
        /\bnew\s+(?:Prisma[A-Z]\w*|\w+Service|\w+LedgerWriter|\w+Hooks|\w+Minter|\w+Registration|\w+Endpoint|\w+Guard|\w+Bridge|RegisteredIssuers|BornFinalizedOptIn)\(/;
      const files = [...sourceFiles(BETTER_AUTH), ...sourceFiles(IDENTITY)];
      const offenders = offendersOf(files, (file, source) =>
        file === RUNTIME
          ? []
          : source
              .split("\n")
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => CONSTRUCTION.test(line))
              .map(({ line, index }) => `L${index + 1} ${line.trim()}`),
      );
      expect(offenders).toEqual([]);
    });

    /** @scenario "The identity services are composed in one file" */
    it("have no satellite runtime beside runtime.ts", () => {
      const satellites = sourceFiles(IDENTITY)
        .filter((file) => /-runtime\.ts$/.test(basename(file)))
        .map(rel);
      expect(satellites).toEqual([]);
    });
  });

  describe("when the sources outside the repository tier are scanned for the questions a repository owns", () => {
    const scope = [
      ...sourceFiles(BETTER_AUTH),
      ...sourceFiles(IDENTITY),
      ...sourceFiles(join(SERVER, "users")),
      ...AUTH_BOUNDARY_FILES,
    ].filter((file) => !isRepositoryTier(file));

    const linesMatching = (source: string, pattern: RegExp) =>
      source
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => pattern.test(line))
        .map(({ line, index }) => `L${index + 1} ${line.trim()}`);

    /** @scenario "A question about the data is asked in one place" */
    it("spell no case-insensitive email match", () => {
      expect(
        offendersOf(scope, (_file, source) =>
          linesMatching(source, /mode:\s*["']insensitive["']/),
        ),
      ).toEqual([]);
    });

    /** @scenario "A question about the data is asked in one place" */
    it("look no organization up by its legacy SSO domain", () => {
      expect(
        offendersOf(scope, (_file, source) =>
          linesMatching(source, /where:\s*\{\s*ssoDomain\b/),
        ),
      ).toEqual([]);
    });

    /** @scenario "A question about the data is asked in one place" */
    it("spell no session cache key scheme", () => {
      expect(
        offendersOf(scope, (_file, source) =>
          linesMatching(source, /active-sessions-/),
        ),
      ).toEqual([]);
    });
  });

  describe("when the better-auth sources are scanned for module-scope mutable bindings", () => {
    /** @scenario "better-auth keeps no state of its own" */
    it("have none", () => {
      const offenders = offendersOf(sourceFiles(BETTER_AUTH), (_file, source) =>
        source
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => /^let\s/.test(line))
          .map(({ line, index }) => `L${index + 1} ${line.trim()}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});
