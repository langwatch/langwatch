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

const REVOKE = "20260825050001_revoke_legacy_impersonating_sessions";
const DROP = "20260825050002_drop_session_impersonating";

describe("given sessions carrying the legacy impersonation payload", () => {
  describe("when the deliverable is deployed", () => {
    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("ends exactly the sessions carrying that payload", () => {
      const statements = statementsIn(sqlOf(REVOKE));

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
          name: REVOKE,
          statement: 'DELETE FROM "Session" WHERE "impersonating" IS NOT NULL',
        },
      ]);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("drops the column only after the sessions holding one have gone", () => {
      const names = migrationNames();
      expect(names).toContain(REVOKE);
      expect(names).toContain(DROP);
      expect(names.indexOf(REVOKE)).toBeLessThan(names.indexOf(DROP));

      expect(statementsIn(sqlOf(DROP))).toEqual([
        'ALTER TABLE "Session" DROP COLUMN "impersonating"',
      ]);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("leaves nothing that reads or writes the payload afterwards", () => {
      const session = parsePrismaDatamodel().find(
        (model) => model.name === "Session",
      );

      expect(session).toBeDefined();
      expect(session?.fields).not.toContain("impersonating");
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
