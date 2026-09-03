/**
 * The teardown-safety rule and its enforcement.
 *
 * The snippet cases pin the rule itself, so it cannot regress to finding
 * nothing; the last case runs it over every test file under `src`, `ee`,
 * and `packages`, which is what actually keeps the dangerous form out.
 * Both ride the ordinary unit shards, so there is no gate that can
 * quietly stop checking (#6169).
 *
 * Spec: specs/setup/test-teardown-safety.feature
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanTestSourceForUnsafeDeleteMany } from "../teardown-scan";
import { parseSourceText, parseSourceTexts } from "../ts-ast";

function scan(sourceText: string) {
  return scanTestSourceForUnsafeDeleteMany(
    parseSourceText({ fileName: "virtual.test.ts", sourceText }),
  );
}

/** packages/test-harness/, from src/__tests__/. */
const PACKAGE_ROOT = resolve(__dirname, "../..");

/** The workspace root, which is two levels above the app. */
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

/**
 * Every root holding test files this rule covers, as name -> directory.
 *
 * `packages/` is at the workspace root, not under the app: ADR-076 folded the
 * six install roots into one workspace and moved it there. Resolving a bare
 * "packages" against the app finds nothing.
 */
/**
 * Every tree with test files in it.
 *
 * `ee/` was a root until the enterprise code moved under `packages/`, which
 * the packages root already walks; `platform/app/src` was one until the
 * monolith was deleted, and `apps/` took its place — the applications hold
 * tests now, and a scan that named neither would report no offenders forever.
 * A root that no longer exists does not narrow the scan — it fails the case
 * that names it, and while it failed there the packages root's own findings
 * were never asserted at all. That is why an entry is removed rather than left
 * in as a harmless leftover, and why removing one surfaces violations that
 * were always present: an aborted guard reports no offenders forever.
 */
const TEST_ROOTS: Record<string, string> = Object.fromEntries(
  (
    [
      ["harness", resolve(PACKAGE_ROOT, "src")],
      ["packages", resolve(REPO_ROOT, "packages")],
      ["apps", resolve(REPO_ROOT, "apps")],
    ] as const
  ).filter(([, directory]) => existsSync(directory)),
);

const TEST_FILE_PATTERN = /\.(test|spec)\.(c|m)?[jt]sx?$/;

function isSkippedEntry(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

function collectTestFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isSkippedEntry(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectTestFiles(full));
    } else if (TEST_FILE_PATTERN.test(entry.name)) {
      collected.push(full);
    }
  }
  return collected;
}

/**
 * Offender lines for every file worth parsing, in one exchange with the
 * compiler. Parsing file by file costs a round trip each, which over a whole
 * tree is the difference between seconds and not finishing.
 */
function offendersIn(files: string[]): string[] {
  const candidates = files
    .map((file) => ({ file, sourceText: readFileSync(file, "utf8") }))
    .filter(({ sourceText }) => sourceText.includes("deleteMany"));

  const parsed = parseSourceTexts({
    sources: candidates.map(({ file, sourceText }) => ({
      fileName: file,
      sourceText,
    })),
  });

  return parsed.flatMap(({ fileName, source }) =>
    scanTestSourceForUnsafeDeleteMany(source).map(
      (violation) =>
        `${relative(REPO_ROOT, fileName)}:${violation.line} ` +
        `${violation.model}.deleteMany filtered by "${violation.variable}": ` +
        violation.reason,
    ),
  );
}

/**
 * Scan every configured root, returning what was found rather than asserting
 * on it: the file count per root is the caller's proof the walk still sees a
 * tree, and the offenders are what the rule is about.
 */
function scanTestRoots(): {
  filesPerRoot: Record<string, number>;
  offenders: string[];
} {
  const filesPerRoot: Record<string, number> = {};
  const offenders: string[] = [];
  for (const [root, directory] of Object.entries(TEST_ROOTS)) {
    // A root that moved reads as empty here, so the count assertion below
    // names it. Letting readdirSync throw buries that under an ENOENT stack.
    const files = existsSync(directory) ? collectTestFiles(directory) : [];
    filesPerRoot[root] = files.length;
    offenders.push(...offendersIn(files));
  }
  return { filesPerRoot, offenders };
}

describe("scanTestSourceForUnsafeDeleteMany", () => {
  describe("given a delete filtered by a let-declared id", () => {
    /** @scenario "A reassignable id in a raw delete fails the check" */
    it("flags it, naming the variable and the line", () => {
      const violations = scan(
        [
          `let teamId: string;`,
          `beforeAll(async () => { teamId = "team_1"; });`,
          `afterAll(async () => {`,
          `  await prisma.team.deleteMany({ where: { id: teamId } });`,
          `});`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({
          variable: "teamId",
          model: "team",
          line: 4,
        }),
      ]);
    });

    it("flags it inside an in-list, where Prisma collapses the same way", () => {
      const violations = scan(
        [
          `let orgId: string;`,
          `await prisma.team.deleteMany({ where: { organizationId: { in: [orgId] } } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([expect.objectContaining({ variable: "orgId", model: "team" })]);
    });

    it("flags a shorthand property", () => {
      const violations = scan(
        [
          `let organizationId: string;`,
          `await prisma.roleBinding.deleteMany({ where: { organizationId } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({
          variable: "organizationId",
          model: "roleBinding",
        }),
      ]);
    });

    it("sees through a non-null assertion, which does nothing at runtime", () => {
      const violations = scan(
        [
          `let teamId: string | undefined;`,
          `await prisma.team.deleteMany({ where: { id: teamId! } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([expect.objectContaining({ variable: "teamId" })]);
    });
  });

  describe("given a delete filtered by a module constant", () => {
    /** @scenario "A module constant in a raw delete passes the check" */
    it("passes: a const initialized at import time cannot be undefined", () => {
      const violations = scan(
        [
          `const ns = "suite-abc123";`,
          `const orgId = generate("organization").toString();`,
          `await prisma.organization.deleteMany({ where: { id: orgId } });`,
          `await prisma.user.deleteMany({ where: { email: \`x-\${ns}@example.com\` } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([]);
    });

    it("passes literals and safe in-lists", () => {
      const violations = scan(
        [
          `const a = "org_a";`,
          `const b = "org_b";`,
          `await prisma.organization.deleteMany({ where: { id: { in: [a, b] } } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given an unfiltered delete", () => {
    /** @scenario "An unfiltered delete fails the check" */
    it("flags deleteMany with no arguments", () => {
      const violations = scan(`await prisma.team.deleteMany();`);

      expect(violations).toEqual([expect.objectContaining({ variable: "<none>", model: "team" })]);
    });

    /** @scenario "An unfiltered delete fails the check" */
    it("flags deleteMany without a where clause", () => {
      const violations = scan(`await prisma.team.deleteMany({});`);

      expect(violations).toEqual([expect.objectContaining({ variable: "<none>", model: "team" })]);
    });
  });

  describe("given a deleteMany on the unit under test rather than a client", () => {
    /** @scenario "A domain method named deleteMany is not a table" */
    it("passes: a bare receiver has no model segment, so it reaches no table", () => {
      const violations = scan(
        [
          `let recordIds: string[];`,
          `await caller.deleteMany({ datasetId: "d1", recordIds });`,
          `await repository.deleteMany({ recordIds, projectId: "p1" });`,
        ].join("\n"),
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given deleteMany on something other than prisma", () => {
    it("still flags it: any deleteMany through a client is a database write", () => {
      // ctx.prisma, tx, a repository holding the client: the collapse is
      // identical whatever the client is called.
      const violations = scan(
        [
          `let orgId: string;`,
          `await ctx.prisma.organization.deleteMany({ where: { id: orgId } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({ variable: "orgId", model: "organization" }),
      ]);
    });
  });

  describe("given a deleteMany argument that is not an inline object literal", () => {
    it("flags it: a variable or call result cannot be proven safe", () => {
      const violations = scan(
        [
          `let orgId: string;`,
          `const args = { where: { id: orgId } };`,
          `await prisma.team.deleteMany(args);`,
        ].join("\n"),
      );

      expect(violations).toEqual([expect.objectContaining({ variable: "<none>", model: "team" })]);
    });
  });

  describe("given a filter list built from a spread", () => {
    it("flags a reassignable array spread the same as a bare identifier", () => {
      const violations = scan(
        [
          `let teamIds: string[];`,
          `await prisma.team.deleteMany({ where: { id: { in: [...teamIds] } } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([expect.objectContaining({ variable: "teamIds", model: "team" })]);
    });

    it("flags a reassignable object spread merged into the filter", () => {
      const violations = scan(
        [
          `let scope: { organizationId: string };`,
          `await prisma.team.deleteMany({ where: { ...scope } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([expect.objectContaining({ variable: "scope", model: "team" })]);
    });
  });

  describe("when scanning the configured test roots", () => {
    it("finds none of them deleting by a reassignable id", () => {
      const { filesPerRoot, offenders } = scanTestRoots();

      // A root that yields nothing means the walk lost the tree and this
      // case would pass while checking zero files.
      for (const root of Object.keys(TEST_ROOTS)) {
        expect(
          filesPerRoot[root],
          `no test files found under ${root}/, so nothing was scanned`,
        ).toBeGreaterThan(0);
      }

      expect(
        offenders,
        "Route these teardowns through cleanupTestRows " +
          "(packages/test-harness/src/cleanup-test-rows.ts), or filter by a module-level " +
          "const id, which cannot be undefined (#6219).",
      ).toEqual([]);
    });
  });
});
