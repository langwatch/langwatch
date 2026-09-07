import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";
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

interface SourceRange {
  start: number;
  end: number;
}

const linesMatching = (
  source: string,
  pattern: RegExp,
  ignoredRanges: readonly SourceRange[] = [],
) => {
  const lineMatches: string[] = [];
  let lineStart = 0;
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );

  for (const [index, line] of source.split("\n").entries()) {
    const matches = [...line.matchAll(globalPattern)];
    const hasUnignoredMatch = matches.some(({ index: matchIndex }) => {
      const start = lineStart + (matchIndex ?? 0);
      return !ignoredRanges.some(
        (range) => start >= range.start && start < range.end,
      );
    });
    if (hasUnignoredMatch) {
      lineMatches.push(`L${index + 1} ${line.trim()}`);
    }
    lineStart += line.length + 1;
  }
  return lineMatches;
};

/**
 * A repository may expose a private constructor through its own static
 * factory. That is composition, not a satellite construction: the class owns
 * the factory and the factory constructs only that class. Parse the syntax so
 * comments, strings and another construction on the same line cannot widen
 * this exception.
 */
function ownStaticFactoryRanges(source: string): SourceRange[] {
  interface SyntaxToken {
    kind: SyntaxKind;
    text: string;
    start: number;
    end: number;
  }

  const scanner = createScanner(
    true,
    LanguageVariant.Standard,
    source,
    0,
    source.length,
  );
  const tokens: SyntaxToken[] = [];
  let previousEnd = 0;
  for (;;) {
    const kind = scanner.scan();
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    if (end <= previousEnd) {
      if (previousEnd >= source.length) break;
      scanner.resetTokenState(Math.min(source.length, previousEnd + 1));
      continue;
    }
    previousEnd = end;
    if (kind === SyntaxKind.EndOfFile) break;
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      start,
      end,
    });
  }

  const matchingToken = (
    openIndex: number,
    openKind: SyntaxKind,
    closeKind: SyntaxKind,
  ): number => {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index += 1) {
      const kind = tokens[index]?.kind;
      if (kind === openKind) depth += 1;
      if (kind === closeKind) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  };

  const findNext = (
    start: number,
    end: number,
    kind: SyntaxKind,
  ): number => {
    for (let index = start; index < end; index += 1) {
      if (tokens[index]?.kind === kind) return index;
    }
    return -1;
  };

  const ranges: SourceRange[] = [];

  for (let classIndex = 0; classIndex < tokens.length; classIndex += 1) {
    if (tokens[classIndex]?.kind !== SyntaxKind.ClassKeyword) continue;
    const classNameToken = tokens[classIndex + 1];
    if (classNameToken?.kind !== SyntaxKind.Identifier) continue;

    const classOpen = findNext(
      classIndex + 2,
      tokens.length,
      SyntaxKind.OpenBraceToken,
    );
    if (classOpen < 0) continue;
    const classClose = matchingToken(
      classOpen,
      SyntaxKind.OpenBraceToken,
      SyntaxKind.CloseBraceToken,
    );
    if (classClose < 0) continue;

    let memberDepth = 0;
    let hasPrivateConstructor = false;
    const factoryBodies: Array<{ start: number; end: number }> = [];
    for (let index = classOpen + 1; index < classClose; index += 1) {
      const token = tokens[index];
      if (memberDepth === 0) {
        if (
          token?.kind === SyntaxKind.PrivateKeyword &&
          tokens[index + 1]?.kind === SyntaxKind.ConstructorKeyword
        ) {
          hasPrivateConstructor = true;
        }
        if (
          token?.kind === SyntaxKind.StaticKeyword &&
          tokens[index + 1]?.text === "create"
        ) {
          const bodyOpen = findNext(
            index + 2,
            classClose,
            SyntaxKind.OpenBraceToken,
          );
          if (bodyOpen >= 0) {
            const bodyClose = matchingToken(
              bodyOpen,
              SyntaxKind.OpenBraceToken,
              SyntaxKind.CloseBraceToken,
            );
            if (bodyClose >= 0 && bodyClose <= classClose) {
              factoryBodies.push({ start: bodyOpen, end: bodyClose });
              index = bodyClose;
              continue;
            }
          }
        }
      }
      if (token?.kind === SyntaxKind.OpenBraceToken) memberDepth += 1;
      if (token?.kind === SyntaxKind.CloseBraceToken) memberDepth -= 1;
    }

    if (!hasPrivateConstructor) continue;
    for (const body of factoryBodies) {
      for (let index = body.start + 1; index < body.end; index += 1) {
        const token = tokens[index];
        if (
          token?.kind !== SyntaxKind.NewKeyword ||
          tokens[index + 1]?.kind !== SyntaxKind.Identifier ||
          tokens[index + 1]?.text !== classNameToken.text
        ) {
          continue;
        }
        const openParen = index + 2;
        const closeParen =
          tokens[openParen]?.kind === SyntaxKind.OpenParenToken
            ? matchingToken(
                openParen,
                SyntaxKind.OpenParenToken,
                SyntaxKind.CloseParenToken,
              )
            : -1;
        ranges.push({
          start: token.start,
          end:
            tokens[closeParen >= 0 ? closeParen : index + 1]?.end ?? token.end,
        });
      }
    }
  }

  return ranges;
}

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
          // Legacy Auth0/SSO callbacks stay byte-for-byte compatible until
          // the connection cutover lands in its own PR.
          "server/better-auth/hooks.ts",
          "server/better-auth/index.ts",
        ]),
      ).toEqual(CLEAN);
    });

    /** @scenario "better-auth never opens the database itself" */
    it("import the composition root only from index.ts and config/", () => {
      // The assembly, and nothing else: `index.ts` reads the composition root
      // and hands what it finds to the modules under `config/`. A plugin, a
      // guard or a hook that reached for the root itself would be the cycle
      // ADR-129 removed, and the lazy construction that held it together.
      const assembles = (file: string) =>
        rel(file) === "server/better-auth/index.ts" ||
        rel(file).startsWith("server/better-auth/config/");
      const offenders = offendersOf(
        sourceFiles(BETTER_AUTH).filter((file) => !assembles(file)),
        (file) =>
          valueImportSpecifiers(file).filter((specifier) =>
            specifier.includes("app-layer/identity/runtime"),
          ),
      );
      expect(
        ratchet(offenders, [
          // The existing shadow adapter predates this migration and remains
          // the rollback path for current SSO customers.
          "server/better-auth/signInRouterShadow.ts",
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
          // Both are pre-existing SSO compatibility owners. The ratchet
          // prevents a third owner while the connection cutover replaces
          // them in its own migration.
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
        file === RUNTIME
          ? []
          : linesMatching(source, CONSTRUCTION, ownStaticFactoryRanges(source)),
      );
      expect(ratchet(offenders, [])).toEqual(CLEAN);
    });

    it("only exempts an own private static factory construction", () => {
      const CONSTRUCTION = /\bnew\s+(?:\w+Service)\(/;
      const fixtures = [
        {
          name: "own private static factory",
          source:
            "class FixtureService { private constructor() {} static create() { return new FixtureService(); } }",
          expected: 0,
        },
        {
          name: "outside the factory",
          source:
            "class FixtureService { private constructor() {} static create() { return new FixtureService(); } method() { return new FixtureService(); } }",
          expected: 1,
        },
        {
          name: "another class in the factory",
          source:
            "class FixtureService { private constructor() {} static create() { return new OtherService(); } }",
          expected: 1,
        },
        {
          name: "a non-private constructor",
          source:
            "class FixtureService { constructor() {} static create() { return new FixtureService(); } }",
          expected: 1,
        },
        {
          name: "another construction on the same line",
          source:
            "class FixtureService { private constructor() {} static create() { return new FixtureService(), new OtherService(); } }",
          expected: 1,
        },
      ];

      for (const fixture of fixtures) {
        expect(
          linesMatching(
            fixture.source,
            CONSTRUCTION,
            ownStaticFactoryRanges(fixture.source),
          ),
          fixture.name,
        ).toHaveLength(fixture.expected);
      }
    });

    /** @scenario "The identity services are composed in one file" */
    it("have no satellite runtime beside runtime.ts", () => {
      const satellites = sourceFiles(IDENTITY)
        .filter((file) => /-runtime\.ts$/.test(basename(file)))
        .map(rel)
        .sort();
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

    /** @scenario "A question about the data is asked in one place" */
    it("spell no case-insensitive email match", () => {
      const offenders = offendersOf(scope, (_file, source) =>
        linesMatching(source, /mode:\s*["']insensitive["']/),
      );
      expect(
        ratchet(offenders, [
          "server/app-layer/identity/sso-connection-backoffice.service.ts",
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
      expect(ratchet(offenders, [])).toEqual(CLEAN);
    });
  });
});
