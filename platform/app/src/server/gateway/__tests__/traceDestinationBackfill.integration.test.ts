/**
 * @vitest-environment node
 *
 * Every key that already exists gets the destination the resolution chain
 * was giving it, written down - against real Postgres, replaying the
 * shipped migration.
 *
 * The chain answered on every read: the key's own `traceProjectId`, then its
 * single PROJECT access scope, then the organization's oldest live
 * governance project. The backfill answers it once and stores the result, so
 * the column becomes the whole story and no key's traffic moves.
 *
 * Every legacy shape is seeded here, including the two that only look alike:
 * a pointer at a project the customer deleted and a pointer at a project of
 * another organization both stop being destinations, and the rules below
 * have to answer for those keys rather than leave them pointing there.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const suffix = nanoid(8);

const ORG_ID = `org-tdb-${suffix}`;
const TEAM_ID = `team-tdb-${suffix}`;
const GOV_OLD_ID = `proj-tdb-gov-old-${suffix}`;
const GOV_LIVE_ID = `proj-tdb-gov-live-${suffix}`;
const LIVE_A_ID = `proj-tdb-live-a-${suffix}`;
const LIVE_B_ID = `proj-tdb-live-b-${suffix}`;
const DELETED_ID = `proj-tdb-deleted-${suffix}`;

// A second organization, so a cross-tenant pointer can be seeded at all.
const OTHER_ORG_ID = `org-tdb-other-${suffix}`;
const OTHER_TEAM_ID = `team-tdb-other-${suffix}`;
const OTHER_PROJECT_ID = `proj-tdb-other-${suffix}`;

// An organization with no governance project: nothing to write for its keys.
const BARE_ORG_ID = `org-tdb-bare-${suffix}`;
const BARE_TEAM_ID = `team-tdb-bare-${suffix}`;

const USER_ID = `usr-tdb-${suffix}`;

const MIGRATION_FILE = join(
  process.cwd(),
  "../../packages/prisma-client/prisma/migrations/20260809120000_virtual_key_stored_trace_destination/migration.sql",
);

/**
 * The backfill statements exactly as shipped. Read from the migration file
 * so this test fails if the rules are ever edited out from under the promise
 * they make, rather than passing against a copy that drifted.
 */
function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  // Whole statements, not lines: each one is a multi-line UPDATE and must
  // arrive intact rather than truncated to its first line.
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter((statement) => statement.startsWith('UPDATE "VirtualKey"'));
  if (statements.length !== 3) {
    throw new Error(
      `expected the migration to carry exactly three backfill statements, found ${statements.length}`,
    );
  }
  return statements;
}

/**
 * Replay the shipped statements, narrowed to this test's own keys.
 *
 * The migration's own WHERE clauses are blanket, which is what a one-shot
 * backfill has to be; narrowing them here keeps the replay from taking a row
 * lock on every VirtualKey in the shared test database until the rollback,
 * which would block any suite running beside it.
 */
async function replayBackfill(
  tx: Prisma.TransactionClient,
  keyIds: string[],
): Promise<void> {
  const scope = keyIds.map((id) => `'${id}'`).join(", ");
  for (const statement of backfillStatements()) {
    await tx.$executeRawUnsafe(`${statement} AND vk."id" IN (${scope})`);
  }
}

type LegacyKey = {
  id: string;
  organizationId: string;
  traceProjectId: string | null;
  scopes: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
};

async function seedLegacyKeys(
  tx: Prisma.TransactionClient,
  keys: LegacyKey[],
): Promise<void> {
  for (const key of keys) {
    await tx.virtualKey.create({
      data: {
        id: key.id,
        organizationId: key.organizationId,
        name: key.id,
        hashedSecret: `hash-${key.id}`,
        displayPrefix: "vk-lw-tdb",
        config: {},
        createdById: USER_ID,
        traceProjectId: key.traceProjectId,
        scopes: { create: key.scopes },
      },
    });
  }
}

async function destinationsOf(
  tx: Prisma.TransactionClient,
  keyIds: string[],
): Promise<Record<string, string | null>> {
  const rows = await tx.virtualKey.findMany({
    where: { id: { in: keyIds } },
    select: { id: true, traceProjectId: true },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.traceProjectId]));
}

describe("the stored trace destination backfill against real PG", () => {
  beforeAll(async () => {
    await startTestContainers();

    for (const [orgId, teamId] of [
      [ORG_ID, TEAM_ID],
      [OTHER_ORG_ID, OTHER_TEAM_ID],
      [BARE_ORG_ID, BARE_TEAM_ID],
    ] as const) {
      await prisma.organization.create({
        data: { id: orgId, name: orgId, slug: orgId },
      });
      await prisma.team.create({
        data: { id: teamId, name: teamId, slug: teamId, organizationId: orgId },
      });
    }

    // `createdAt` is set by hand on the governance projects: the rule picks
    // the oldest, and two rows written in the same millisecond would make
    // which one it picks a coin toss.
    for (const [id, teamId, kind, archivedAt, createdAt] of [
      [
        GOV_OLD_ID,
        TEAM_ID,
        "internal_governance",
        new Date("2026-01-01T00:00:00Z"),
        new Date("2025-01-01T00:00:00Z"),
      ],
      [
        GOV_LIVE_ID,
        TEAM_ID,
        "internal_governance",
        null,
        new Date("2025-06-01T00:00:00Z"),
      ],
      [LIVE_A_ID, TEAM_ID, "application", null, null],
      [LIVE_B_ID, TEAM_ID, "application", null, null],
      [
        DELETED_ID,
        TEAM_ID,
        "application",
        new Date("2026-01-01T00:00:00Z"),
        null,
      ],
      [OTHER_PROJECT_ID, OTHER_TEAM_ID, "application", null, null],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
          kind,
          archivedAt,
          ...(createdAt ? { createdAt } : {}),
        },
      });
    }

    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@tdb.local`, name: "TDB" },
    });
  }, 120_000);

  afterAll(async () => {
    const orgIds = [ORG_ID, OTHER_ORG_ID, BARE_ORG_ID];
    const teamIds = [TEAM_ID, OTHER_TEAM_ID, BARE_TEAM_ID];
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 120_000);

  describe("given one key of every shape the chain used to answer for", () => {
    /** @scenario "A key already pointing at a live project keeps that destination" */
    /** @scenario "A key with no destination takes the project it is scoped to" */
    /** @scenario "A key whose destination was deleted falls back to the governance inbox" */
    /** @scenario "A key in an organization with no governance inbox is left without one" */
    it("writes each the destination its traffic was already going to", async () => {
      const live = `vk-tdb-live-${suffix}`;
      const soleScope = `vk-tdb-sole-${suffix}`;
      const deletedPointer = `vk-tdb-deleted-${suffix}`;
      const foreignPointer = `vk-tdb-foreign-${suffix}`;
      const shared = `vk-tdb-shared-${suffix}`;
      const twoProjects = `vk-tdb-two-${suffix}`;
      const scopedToDeleted = `vk-tdb-scoped-deleted-${suffix}`;
      const homeless = `vk-tdb-homeless-${suffix}`;
      const keyIds = [
        live,
        soleScope,
        deletedPointer,
        foreignPointer,
        shared,
        twoProjects,
        scopedToDeleted,
        homeless,
      ];

      // Rolled back at the end: the shipped statements are a one-shot whose
      // blanket WHERE must never run against the shared database twice.
      const rollback = new Error("rollback");
      await expect(
        prisma.$transaction(async (tx) => {
          await seedLegacyKeys(tx, [
            {
              id: live,
              organizationId: ORG_ID,
              traceProjectId: LIVE_A_ID,
              scopes: [{ scopeType: "PROJECT", scopeId: LIVE_B_ID }],
            },
            {
              id: soleScope,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "PROJECT", scopeId: LIVE_A_ID }],
            },
            {
              id: deletedPointer,
              organizationId: ORG_ID,
              traceProjectId: DELETED_ID,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
            },
            {
              id: foreignPointer,
              organizationId: ORG_ID,
              traceProjectId: OTHER_PROJECT_ID,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
            },
            {
              id: shared,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "TEAM", scopeId: TEAM_ID }],
            },
            {
              id: twoProjects,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [
                { scopeType: "PROJECT", scopeId: LIVE_A_ID },
                { scopeType: "PROJECT", scopeId: LIVE_B_ID },
              ],
            },
            {
              id: scopedToDeleted,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "PROJECT", scopeId: DELETED_ID }],
            },
            {
              id: homeless,
              organizationId: BARE_ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "TEAM", scopeId: BARE_TEAM_ID }],
            },
          ]);

          await replayBackfill(tx, keyIds);

          expect(await destinationsOf(tx, keyIds)).toEqual({
            // A pointer at a live project of this organization is the answer
            // already; the key's own project scope never overrode it.
            [live]: LIVE_A_ID,
            [soleScope]: LIVE_A_ID,
            // Both of these pointed somewhere that stopped being a
            // destination, and the chain was already sending their traces to
            // the inbox. The older inbox is deleted, so not that one.
            [deletedPointer]: GOV_LIVE_ID,
            [foreignPointer]: GOV_LIVE_ID,
            [shared]: GOV_LIVE_ID,
            // Two project scopes name two destinations, so neither wins.
            [twoProjects]: GOV_LIVE_ID,
            // A scope is not a licence to trace into a deleted project.
            [scopedToDeleted]: GOV_LIVE_ID,
            // Nothing to write, and nothing pretending otherwise.
            [homeless]: null,
          });

          throw rollback;
        }),
      ).rejects.toThrow("rollback");

      // The rollback held: no synthetic legacy row survived it.
      expect(
        await prisma.virtualKey.count({ where: { id: { in: keyIds } } }),
      ).toBe(0);
    });
  });

  describe("when the backfill is run a second time", () => {
    /** @scenario "A key already pointing at a live project keeps that destination" */
    it("changes nothing it wrote the first time", async () => {
      // The key that already points at a live project is the one the second
      // run is most likely to disturb: it is the only shape step 1 inspects
      // and decides to leave alone.
      const alreadyLive = `vk-tdb-idem-live-${suffix}`;
      const soleScope = `vk-tdb-idem-sole-${suffix}`;
      const shared = `vk-tdb-idem-shared-${suffix}`;
      const homeless = `vk-tdb-idem-homeless-${suffix}`;
      const keyIds = [alreadyLive, soleScope, shared, homeless];

      const rollback = new Error("rollback");
      await expect(
        prisma.$transaction(async (tx) => {
          await seedLegacyKeys(tx, [
            {
              id: alreadyLive,
              organizationId: ORG_ID,
              traceProjectId: LIVE_A_ID,
              scopes: [{ scopeType: "PROJECT", scopeId: LIVE_B_ID }],
            },
            {
              id: soleScope,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "PROJECT", scopeId: LIVE_B_ID }],
            },
            {
              id: shared,
              organizationId: ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
            },
            {
              id: homeless,
              organizationId: BARE_ORG_ID,
              traceProjectId: null,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: BARE_ORG_ID }],
            },
          ]);

          await replayBackfill(tx, keyIds);
          const afterFirst = await destinationsOf(tx, keyIds);
          await replayBackfill(tx, keyIds);
          const afterSecond = await destinationsOf(tx, keyIds);

          expect(afterFirst).toEqual({
            // Kept, not swapped for the project its own scope names.
            [alreadyLive]: LIVE_A_ID,
            [soleScope]: LIVE_B_ID,
            [shared]: GOV_LIVE_ID,
            [homeless]: null,
          });
          expect(afterSecond).toEqual(afterFirst);

          throw rollback;
        }),
      ).rejects.toThrow("rollback");
    });
  });
});
