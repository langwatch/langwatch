import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-129's tiers as graph facts (specs/identity/identity-service-layering.feature).
 *
 * A plain text scan over the sources, in the same spirit as
 * identity-package-boundaries.unit.test.ts: an import is a line, a query is
 * a line, a `new FooService(` is a line, and the test that reads the same
 * lines a reviewer would is the one that keeps saying the same thing.
 *
 * IT IS A RATCHET, NOT A SNAPSHOT. ADR-129 lands in slices, so each rule
 * carries the list of files that still break it today. A file NOT on the list
 * that breaks the rule fails the build — the tier cannot get worse. A file ON
 * the list that no longer breaks the rule also fails, with the instruction to
 * remove it — the list can only shrink, and when the last entry goes the rule
 * is simply the rule. Every list is expected to be empty by the end of the
 * ADR-129 work; a non-empty one is the refactor's remaining to-do, in code.
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

const linesMatching = (source: string, pattern: RegExp) =>
  source
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, index }) => `L${index + 1} ${line.trim()}`);

/** `{ file: [why, why] }` for every file with at least one finding. */
const offendersOf = (
  files: string[],
  test: (file: string, source: string) => string[],
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const file of files) {
    const findings = test(file, read(file));
    if (findings.length > 0) out[rel(file)] = findings;
  }
  return out;
};

/**
 * The ratchet. `known` is the list of files still breaking the rule today;
 * the caller asserts the answer is CLEAN, which fails on a file that is not on
 * the list (the tier got worse) and on a listed file that no longer breaks it
 * (remove it — the list only shrinks). Failure output names the file and the
 * offending lines.
 */
function ratchet(
  offenders: Record<string, string[]>,
  known: readonly string[],
): { newOffenders: string[]; staleEntries: string[] } {
  const found = Object.keys(offenders).sort();
  return {
    newOffenders: found
      .filter((file) => !known.includes(file))
      .map((file) => `${file}\n    ${(offenders[file] ?? []).join("\n    ")}`),
    staleEntries: known.filter((file) => !found.includes(file)),
  };
}

/** No new offender, no listed file that has stopped offending. */
const CLEAN = { newOffenders: [], staleEntries: [] };

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
      expect(
        ratchet(offenders, [
          "server/better-auth/hooks.ts",
          "server/better-auth/index.ts",
        ]),
      ).toEqual(CLEAN);
    });
  });

  describe("when the identity trees are scanned for queries", () => {
    /** @scenario "Prisma is spelled in the repository tier only" */
    it("query only from a repository or adapter file", () => {
      const files = [...sourceFiles(BETTER_AUTH), ...sourceFiles(IDENTITY)];
      // The composition root holds the client to construct repositories; a
      // query in it is the same violation as a query anywhere else.
      const offenders = offendersOf(files, (file, source) =>
        isRepositoryTier(file) ? [] : linesMatching(source, QUERY),
      );
      expect(
        ratchet(offenders, [
          "server/app-layer/identity/platform-operators.ts",
          "server/app-layer/identity/runtime.ts",
          "server/app-layer/identity/sso-connection-backoffice.service.ts",
          "server/better-auth/hooks.ts",
        ]),
      ).toEqual(CLEAN);
    });

    /** @scenario "Prisma is spelled in the repository tier only" */
    it("keep the auth routers and route off the account, session, passkey, verification and SSO rows", () => {
      const AUTH_ROW =
        /\bprisma\.(?:account|session|passkey|verification|ssoProvider|ssoConnection|twoFactor)\.(?:find|count|create|update|upsert|delete)/;
      const offenders = offendersOf(AUTH_BOUNDARY_FILES, (_file, source) =>
        linesMatching(source, AUTH_ROW),
      );
      expect(ratchet(offenders, [])).toEqual(CLEAN);
    });
  });

  describe("when every construction in the identity trees is located", () => {
    /** @scenario "The identity services are composed in one file" */
    it("construct services, Prisma repositories and ledger writers only in runtime.ts", () => {
      const CONSTRUCTION =
        /\bnew\s+(?:Prisma[A-Z]\w*|\w+Service|\w+LedgerWriter|\w+Hooks|\w+Minter|\w+Registration|\w+Endpoint|\w+Guard|\w+Bridge|RegisteredIssuers|BornFinalizedOptIn)\(/;
      const files = [...sourceFiles(BETTER_AUTH), ...sourceFiles(IDENTITY)];
      const offenders = offendersOf(files, (file, source) =>
        file === RUNTIME ? [] : linesMatching(source, CONSTRUCTION),
      );
      expect(
        ratchet(offenders, [
          "server/app-layer/identity/identity-lookup-runtime.ts",
          "server/app-layer/identity/scim-reconciliation-runtime.ts",
          "server/app-layer/identity/two-step-runtime.ts",
          "server/better-auth/index.ts",
        ]),
      ).toEqual(CLEAN);
    });

    /** @scenario "The identity services are composed in one file" */
    it("have no satellite runtime beside runtime.ts", () => {
      const satellites = sourceFiles(IDENTITY)
        .filter((file) => /-runtime\.ts$/.test(basename(file)))
        .map(rel)
        .sort();
      expect(satellites).toEqual([
        "server/app-layer/identity/identity-lookup-runtime.ts",
        "server/app-layer/identity/scim-reconciliation-runtime.ts",
        "server/app-layer/identity/two-step-runtime.ts",
      ]);
    });
  });

  describe("when the sources outside the repository tier are scanned for the questions a repository owns", () => {
    const scope = [
      ...sourceFiles(BETTER_AUTH),
      ...sourceFiles(IDENTITY),
      ...sourceFiles(join(SERVER, "users")),
      ...AUTH_BOUNDARY_FILES,
    ].filter((file) => !isRepositoryTier(file));

    /** @scenario "A question about the data is asked in one place" */
    it("spell no case-insensitive email match", () => {
      const offenders = offendersOf(scope, (_file, source) =>
        linesMatching(source, /mode:\s*["']insensitive["']/),
      );
      expect(
        ratchet(offenders, [
          "server/app-layer/identity/runtime.ts",
          "server/app-layer/identity/sso-connection-backoffice.service.ts",
          "server/better-auth/hooks.ts",
        ]),
      ).toEqual(CLEAN);
    });

    /** @scenario "A question about the data is asked in one place" */
    it("look no organization up by its legacy SSO domain", () => {
      const offenders = offendersOf(scope, (_file, source) =>
        linesMatching(source, /where:\s*\{\s*ssoDomain\b/),
      );
      expect(ratchet(offenders, ["server/better-auth/hooks.ts"])).toEqual(
        CLEAN,
      );
    });

    /** @scenario "A question about the data is asked in one place" */
    it("spell no session cache key scheme", () => {
      const offenders = offendersOf(scope, (_file, source) =>
        linesMatching(source, /active-sessions-/),
      );
      expect(ratchet(offenders, [])).toEqual(CLEAN);
    });
  });

  describe("when the better-auth sources are scanned for module-scope mutable bindings", () => {
    /** @scenario "better-auth keeps no state of its own" */
    it("have none", () => {
      const offenders = offendersOf(sourceFiles(BETTER_AUTH), (_file, source) =>
        linesMatching(source, /^let\s/),
      );
      expect(ratchet(offenders, ["server/better-auth/index.ts"])).toEqual(
        CLEAN,
      );
    });
  });
});
