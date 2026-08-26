/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePrismaDatamodel } from "~/test-utils/prismaDatamodel";

/**
 * The one revoke this deliverable performs, read off the migrations
 * themselves (D06).
 *
 * The migration SQL is the artifact under test, not a stand-in for one: what
 * has to be true is that exactly one statement in the whole deliverable
 * deletes sessions, that its predicate is the legacy impersonation payload
 * and nothing else, and that the column is dropped only after that statement
 * has run. Those are properties of the FILES and their order, and a database
 * that had already been migrated could no longer show them — the evidence
 * would be gone with the column.
 *
 * jsdom and no datastore, so it runs in the component lane, like the other
 * D06 integration tests over in-memory doubles.
 *
 * @see specs/identity/mfa-and-session-shape.feature
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma/migrations");

const migrationNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const sqlOf = (name: string): string =>
  readFileSync(resolve(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

/** Statements, comments and blank lines stripped — what actually runs. */
const statementsIn = (sql: string): string[] =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => statement.length > 0);

// Found by SUFFIX, never by timestamp. `cmd/migrationorder` renumbers this
// branch on every rebase, and a name written out by hand does not follow it —
// which is exactly how the previous spelling of this file went stale.
const named = (suffix: string): string => {
  const matches = migrationNames().filter((name) => name.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one migration ending "${suffix}", found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return matches[0]!;
};

const REVOKE_SUFFIX = "_revoke_legacy_impersonating_sessions";

/**
 * Every server source that names the legacy payload as a value — an object key
 * a Prisma call could pass, or a property read off a row.
 *
 * The authz principal carries an unrelated boolean of the same name (whether
 * THIS request is an impersonation, derived from the {actor, subject} claims),
 * so those two modules are named rather than matched. Anything else naming it
 * is reading a column that is about to stop existing.
 */
const AUTHZ_OWN_FLAG = [
  "server/app-layer/authz/decision-record.ts",
  "server/app-layer/authz/principal.ts",
];

const readersOfTheLegacyPayload = (): string[] => {
  const roots = [resolve(process.cwd(), "src", "server")];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = full.slice(resolve(process.cwd(), "src").length + 1);
      if (AUTHZ_OWN_FLAG.includes(relative)) continue;
      const source = readFileSync(full, "utf8")
        // Comments still discuss the column, and should.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/(^|[.{,\s])impersonating\s*[:.]/.test(source)) found.push(relative);
    }
  };
  for (const root of roots) walk(root);
  return found.sort();
};

describe("given sessions carrying the legacy impersonation payload", () => {
  describe("when the deliverable is deployed", () => {
    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("ends exactly the sessions carrying that payload", () => {
      const statements = statementsIn(sqlOf(named(REVOKE_SUFFIX)));

      expect(statements).toEqual([
        'DELETE FROM "Session" WHERE "impersonating" IS NOT NULL',
      ]);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("keeps every ordinary session, including the ones that proved nothing", () => {
      const deletes = migrationNames()
        .filter((name) => name.startsWith("202608"))
        .flatMap((name) =>
          statementsIn(sqlOf(name)).map((statement) => ({ name, statement })),
        )
        .filter(
          ({ statement }) =>
            /^DELETE FROM "Session"/i.test(statement) ||
            /^TRUNCATE .*"Session"/i.test(statement),
        );

      // One statement in the whole wave touches the session table, and it is
      // the impersonation revoke. Nothing keys on `amr`, on `identifierId`,
      // or on a session having recorded nothing.
      expect(deletes).toEqual([
        {
          name: named(REVOKE_SUFFIX),
          statement: 'DELETE FROM "Session" WHERE "impersonating" IS NOT NULL',
        },
      ]);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("leaves the column standing, because dropping it here signs everybody out", () => {
      // Expand now, contract next release. `prisma migrate deploy` runs at
      // container start, so a drop in THIS release runs while the previous
      // release's pods are still selecting the column on every authenticated
      // request. An earlier cut of this branch did drop it here; the restore
      // migration exists to repair the developer databases that ran it.
      const drops = migrationNames().flatMap((name) =>
        statementsIn(sqlOf(name))
          .filter((statement) =>
            /ALTER TABLE "Session" DROP COLUMN "impersonating"/i.test(
              statement,
            ),
          )
          .map((statement) => ({ name, statement })),
      );

      expect(drops).toEqual([]);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("leaves nothing that reads or writes the payload afterwards", () => {
      const session = parsePrismaDatamodel().find(
        (model) => model.name === "Session",
      );

      expect(session).toBeDefined();
      // The column is still DECLARED, and deliberately so — see the scenario
      // above. The claim here is the other half: nothing reaches for it.
      expect(readersOfTheLegacyPayload()).toEqual([]);
      // What replaced it: the {actor, subject} claims the authz principal
      // speaks, plus the reason and the window.
      expect(session?.fields).toEqual(
        expect.arrayContaining([
          "actorUserId",
          "subjectUserId",
          "impersonationReason",
          "impersonationExpiresAt",
        ]),
      );
    });
  });
});
