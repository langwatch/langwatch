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
 * Where this wave begins, so the claim below covers it and everything after
 * rather than one month. Migrations sort lexically, so a string compare is
 * the same order the runner applies them in.
 */
const WAVE_STARTS_AT = "20260825";

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
      const deletes = statements.filter((statement) =>
        /DELETE FROM "Session"/i.test(statement),
      );

      // One delete, and `impersonating IS NOT NULL` is the WHOLE predicate:
      // no user id, no date range, no "while we are here".
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toContain(
        'DELETE FROM "Session" WHERE "impersonating" IS NOT NULL',
      );
    });

    it("runs it only where the column still exists", () => {
      // GUARDED, because this migration can arrive at a database that no
      // longer has the column: an earlier numbering of this branch dropped it
      // on developer databases, and the migration that repairs those sorts
      // AFTER this one. Unguarded, the run aborted here and never reached the
      // repair — so the repair was unreachable on every database that needed
      // it.
      const sql = sqlOf(named(REVOKE_SUFFIX));

      expect(sql).toMatch(/information_schema\.columns/i);
      expect(sql).toMatch(/column_name = 'impersonating'/i);
    });

    /** @scenario "The one revoke at deploy is the impersonating sessions" */
    it("keeps every ordinary session, including the ones that proved nothing", () => {
      // FROM THE WAVE ONWARD, rather than a single month.
      //
      // A prefix of `202608` scoped this to August, so a migration authored
      // in September carrying `DELETE FROM "Session"` was invisible: it would
      // leave `deletes` unchanged and the test green, while the comment below
      // went on claiming one statement touches the table. The file warns
      // against hard-coding a timestamp sixty lines above this.
      //
      // A lower bound rather than no bound, because the table WAS emptied
      // once before, by `20260410233000_better_auth_destructive` — a
      // deliberate cutover long since deployed. The claim being made is about
      // this wave and everything after it, so that is what the scan covers.
      const deletes = migrationNames()
        .filter((name) => name >= WAVE_STARTS_AT)
        .flatMap((name) =>
          statementsIn(sqlOf(name)).map((statement) => ({ name, statement })),
        )
        .filter(
          ({ statement }) =>
            /DELETE FROM "Session"/i.test(statement) ||
            /TRUNCATE .*"Session"/i.test(statement),
        );

      // One statement from this wave onward touches the session table, and it
      // is the impersonation revoke. Nothing keys on `amr`, on
      // `identifierId`, or on a session having recorded nothing.
      expect(deletes.map(({ name }) => name)).toEqual([named(REVOKE_SUFFIX)]);
      expect(deletes[0]?.statement).toContain(
        'DELETE FROM "Session" WHERE "impersonating" IS NOT NULL',
      );
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
