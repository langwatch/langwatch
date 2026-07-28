/**
 * @vitest-environment node
 *
 * Integration coverage for the #4805 report-only detection migration.
 *
 * Hits real PG -- NO MOCKS. Proves the ACTUAL shipped migration.sql (read
 * from disk and executed statement-by-statement, not a reimplementation of
 * its logic) against seeded "Trigger" fixtures in both storage shapes:
 *   1. An object-shaped and a string-shaped (JSON.stringify'd) phantom
 *      `evaluations.state` value each produce exactly one finding.
 *   2. A canonical-only value, a phantom-shaped value under a sibling key
 *      (metadata.value / evaluations.label), a soft-deleted trigger, and a
 *      trigger with no evaluations.state key at all each produce nothing.
 *   3. Several evaluator keys each holding a phantom value produce one
 *      finding per key.
 *   4. A jsonb-string row whose inner text does not parse is reported as
 *      malformed instead of aborting the statement.
 *   5. The scan never writes to "Trigger" (every seeded row's xmin is
 *      unchanged) and is safe to run twice (zero new findings the second
 *      time).
 *
 * Spec: specs/automations/evaluation-state-filter-repair.feature
 * Migration: prisma/migrations/20260728120000_report_noncanonical_evaluation_state
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaClient, type Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { evaluationRunDataSchema } from "~/server/app-layer/evaluations/types";

/**
 * The canonical execution-state domain, derived from the schema so this
 * suite cannot go stale relative to it -- never a hand-copied literal
 * (the exact drift #6296 was filed for).
 */
const CANONICAL_STATUS_VALUES = evaluationRunDataSchema.shape.status.options;

const MIGRATION_SQL_PATH = path.join(
  __dirname,
  "../../../../prisma/migrations/20260728120000_report_noncanonical_evaluation_state/migration.sql",
);
const migrationSql = fs.readFileSync(MIGRATION_SQL_PATH, "utf-8");

/** Marks where a dollar-quoted body was cut out of the SQL text below, so
 * the placeholder can never be mistaken for real SQL content (a bare
 * number, or anything shorter/more generic, risks exactly that collision).
 */
const DOLLAR_QUOTE_PLACEHOLDER_PREFIX = "LW_DOLLAR_QUOTED_BODY_";

/**
 * Splits a .sql file into individually-executable statements so the test
 * can replay the migration's scan more than once (once against
 * freshly-seeded fixtures, once more to prove idempotency). A plain
 * `split(";")` would cut the migration's plpgsql helper function in half --
 * its body contains statement-terminating semicolons of its own -- so
 * dollar-quoted regions (`$tag$ ... $tag$`) are protected first and
 * restored after the split.
 */
function splitSqlStatements(sql: string): string[] {
  const dollarQuotedBodies: string[] = [];
  const withProtectedBodies = sql.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_]*)?\$[\s\S]*?\$\1\$/g,
    (match) => {
      const token = `${DOLLAR_QUOTE_PLACEHOLDER_PREFIX}${dollarQuotedBodies.length}`;
      dollarQuotedBodies.push(match);
      return token;
    },
  );

  const placeholderPattern = new RegExp(
    `${DOLLAR_QUOTE_PLACEHOLDER_PREFIX}(\\d+)`,
    "g",
  );

  return withProtectedBodies
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) =>
      statement.replace(
        placeholderPattern,
        (_match, index: string) => dollarQuotedBodies[Number(index)]!,
      ),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Executes the migration's actual SQL text against `db`. Safe to call more
 * than once: every DDL statement is `IF NOT EXISTS`/`OR REPLACE`/
 * `IF EXISTS`-guarded and both scans are guarded by their own `NOT EXISTS`
 * check, so a second call is expected to add zero rows.
 */
async function runMigrationStatements({
  db,
  sql,
}: {
  db: PrismaClient;
  sql: string;
}): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}

type FindingRow = {
  shape: string;
  evaluatorKey: string | null;
  offendingValue: string | null;
  rawFilters: string | null;
  action: string;
};

async function queryFindings({
  db,
  triggerId,
}: {
  db: PrismaClient;
  triggerId: string;
}): Promise<FindingRow[]> {
  return db.$queryRaw<FindingRow[]>`
    SELECT "shape", "evaluatorKey", "offendingValue", "rawFilters", "action"
    FROM "TriggerFilterFinding"
    WHERE "triggerId" = ${triggerId}
  `;
}

async function countFindings({
  db,
  triggerIds,
}: {
  db: PrismaClient;
  triggerIds: string[];
}): Promise<number> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM "TriggerFilterFinding"
    WHERE "triggerId" = ANY(${triggerIds}::text[])
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Snapshots the Postgres system column `xmin` per row -- the report-only
 * guarantee this suite exists to prove. `updatedAt` is NOT valid evidence
 * here: it is Prisma-client-side `@updatedAt`, so raw SQL never bumps it on
 * any row regardless of whether the migration writes to "Trigger" -- that
 * assertion would be structurally incapable of failing. `xmin` is the
 * actual Postgres row version; it changes on ANY write to the row,
 * including ones issued outside Prisma's client.
 */
async function snapshotXmins({
  db,
  triggerIds,
}: {
  db: PrismaClient;
  triggerIds: string[];
}): Promise<Record<string, string>> {
  const rows = await db.$queryRaw<{ id: string; xmin: string }[]>`
    SELECT "id", xmin::text AS xmin
    FROM "Trigger"
    WHERE "id" = ANY(${triggerIds}::text[])
  `;
  return Object.fromEntries(rows.map((row) => [row.id, row.xmin]));
}

async function createTrigger({
  projectId,
  name,
  filters,
  deleted = false,
}: {
  projectId: string;
  name: string;
  filters: Prisma.InputJsonValue;
  deleted?: boolean;
}) {
  return prisma.trigger.create({
    data: {
      projectId,
      name,
      action: "SEND_EMAIL",
      actionParams: {},
      filters,
      deleted,
    },
  });
}

const suffix = nanoid(8);
const ORG_ID = `org-tff-${suffix}`;
const TEAM_ID = `team-tff-${suffix}`;
const PROJECT_ID = `proj-tff-${suffix}`;

describe("evaluation-state report-only migration (TriggerFilterFinding)", () => {
  // Separate, middleware-free client: the scan and the sidecar table are
  // intentionally cross-tenant (one migration walks every project's
  // triggers), and the actual migration -- applied by Prisma Migrate, not
  // through src/server/db.ts -- never goes through the app's guarded
  // client either. Reusing the guarded `prisma` singleton here would hit
  // dbMultiTenancyProtection.ts's raw-query tenancy guard on statements
  // like `CREATE INDEX ... ON "TriggerFilterFinding"("triggerId")`, which
  // names no projectId/organizationId/tenantId at all.
  let rawDb: PrismaClient;

  let objectPhantomTrigger: { id: string };
  let stringPhantomTrigger: { id: string };
  let canonicalOnlyTrigger: { id: string };
  let metadataValueSiblingTrigger: { id: string };
  let evaluationsLabelSiblingTrigger: { id: string };
  let multiEvaluatorTrigger: { id: string };
  let malformedTrigger: { id: string };
  let deletedPhantomTrigger: { id: string };
  let noStateKeyTrigger: { id: string };
  let allTriggerIds: string[];
  let xminBeforeScan: Record<string, string>;

  beforeAll(async () => {
    rawDb = new PrismaClient();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `TFF Org ${suffix}`, slug: `tff-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `TFF Team ${suffix}`,
        slug: `tff-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `TFF Project ${suffix}`,
        slug: `tff-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-tff-${suffix}`,
      },
    });

    objectPhantomTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "object-shaped phantom",
      filters: { "evaluations.state": { e1: ["Error_Message"] } },
    });
    stringPhantomTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "string-shaped phantom",
      // Mirrors every current write path (app.ts, trigger.prisma.repository.ts):
      // JSON.stringify() before Prisma, so the column stores a jsonb STRING
      // whose inner text is the real filters object.
      filters: JSON.stringify({
        "evaluations.state": { e1: ["Error_Message"] },
      }),
    });
    canonicalOnlyTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "canonical-only",
      filters: {
        "evaluations.state": { e1: [CANONICAL_STATUS_VALUES[0]] },
      },
    });
    metadataValueSiblingTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "phantom-shaped value under metadata.value",
      filters: { "metadata.value": { reason: ["Error_Message"] } },
    });
    evaluationsLabelSiblingTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "phantom-shaped value under evaluations.label",
      filters: { "evaluations.label": { e1: ["Error_Message"] } },
    });
    multiEvaluatorTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "two evaluators, two phantoms",
      filters: {
        "evaluations.state": {
          e1: ["Weird_Legacy"],
          e2: ["Error_Message"],
        },
      },
    });
    malformedTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "malformed jsonb-string filters",
      // A 7-char JS string. Prisma JSON-encodes it before storage, so the
      // stored jsonb value is the string scalar `"{broken"` -- exactly
      // `'"{broken"'::jsonb`: a jsonb string whose inner text ("{broken")
      // starts with '{' but is not valid JSON.
      filters: "{broken",
    });
    deletedPhantomTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "deleted, otherwise-phantom",
      filters: { "evaluations.state": { e1: ["Error_Message"] } },
      deleted: true,
    });
    noStateKeyTrigger = await createTrigger({
      projectId: PROJECT_ID,
      name: "no evaluations.state key",
      filters: {},
    });

    allTriggerIds = [
      objectPhantomTrigger.id,
      stringPhantomTrigger.id,
      canonicalOnlyTrigger.id,
      metadataValueSiblingTrigger.id,
      evaluationsLabelSiblingTrigger.id,
      multiEvaluatorTrigger.id,
      malformedTrigger.id,
      deletedPhantomTrigger.id,
      noStateKeyTrigger.id,
    ];

    // Captured BEFORE the scan runs so the report-only guarantee test
    // below can compare "across the run".
    xminBeforeScan = await snapshotXmins({ db: rawDb, triggerIds: allTriggerIds });

    await runMigrationStatements({ db: rawDb, sql: migrationSql });
  }, 60_000);

  afterAll(async () => {
    await rawDb.$executeRaw`
      DELETE FROM "TriggerFilterFinding" WHERE "triggerId" = ANY(${allTriggerIds}::text[])
    `;
    await prisma.trigger.deleteMany({ where: { projectId: PROJECT_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await rawDb.$disconnect();
  }, 60_000);

  describe("given a trigger whose evaluations.state holds a non-canonical value", () => {
    describe("when the filters column is object-shaped", () => {
      it("reports exactly one finding for the offending evaluator and value", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: objectPhantomTrigger.id,
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          shape: "object",
          evaluatorKey: "e1",
          offendingValue: "Error_Message",
          action: "reported_unmappable",
        });
      });
    });

    describe("when the filters column is string-shaped (JSON.stringify'd)", () => {
      it("reports exactly one finding for the offending evaluator and value", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: stringPhantomTrigger.id,
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          shape: "string",
          evaluatorKey: "e1",
          offendingValue: "Error_Message",
          action: "reported_unmappable",
        });
      });
    });

    describe("when the value is one of the five canonical execution states", () => {
      it("produces no finding at all", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: canonicalOnlyTrigger.id,
        });

        expect(findings).toHaveLength(0);
      });
    });

    describe("when several evaluator keys each hold a non-canonical value", () => {
      it("reports one finding per evaluator key", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: multiEvaluatorTrigger.id,
        });

        expect(findings).toHaveLength(2);
        expect(findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              evaluatorKey: "e1",
              offendingValue: "Weird_Legacy",
              action: "reported_unmappable",
            }),
            expect.objectContaining({
              evaluatorKey: "e2",
              offendingValue: "Error_Message",
              action: "reported_unmappable",
            }),
          ]),
        );
      });
    });
  });

  describe("given a phantom-shaped value stored under a different filter key", () => {
    describe("when the key is metadata.value", () => {
      it("produces no findings", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: metadataValueSiblingTrigger.id,
        });

        expect(findings).toHaveLength(0);
      });
    });

    describe("when the key is the evaluations.label sibling field", () => {
      it("produces no findings", async () => {
        // The naive implementation this guards against is a prefix match
        // on "evaluations." -- evaluations.label is not evaluations.state.
        const findings = await queryFindings({
          db: rawDb,
          triggerId: evaluationsLabelSiblingTrigger.id,
        });

        expect(findings).toHaveLength(0);
      });
    });
  });

  describe("given a trigger outside the scan's scope", () => {
    describe("when the trigger is soft-deleted", () => {
      it("produces no findings even though its filters hold a phantom value", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: deletedPhantomTrigger.id,
        });

        expect(findings).toHaveLength(0);
      });
    });

    describe("when the filters object has no evaluations.state key", () => {
      it("produces no findings", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: noStateKeyTrigger.id,
        });

        expect(findings).toHaveLength(0);
      });
    });
  });

  describe("given a trigger whose filters cannot be normalized to an object", () => {
    describe("when the jsonb string's inner text does not parse", () => {
      it("is reported as malformed instead of aborting the run", async () => {
        const findings = await queryFindings({
          db: rawDb,
          triggerId: malformedTrigger.id,
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          action: "reported_malformed",
          evaluatorKey: null,
          offendingValue: null,
        });
        expect(findings[0]!.rawFilters).not.toBeNull();
      });
    });
  });

  describe("the report-only guarantee", () => {
    it("leaves every seeded Trigger row's xmin unchanged across the run", async () => {
      const xminAfterScan = await snapshotXmins({
        db: rawDb,
        triggerIds: allTriggerIds,
      });

      expect(xminAfterScan).toEqual(xminBeforeScan);
    });

    it("adds zero findings when the scan runs a second time", async () => {
      const before = await countFindings({ db: rawDb, triggerIds: allTriggerIds });

      await runMigrationStatements({ db: rawDb, sql: migrationSql });

      const after = await countFindings({ db: rawDb, triggerIds: allTriggerIds });
      expect(after).toBe(before);
    });
  });
});
