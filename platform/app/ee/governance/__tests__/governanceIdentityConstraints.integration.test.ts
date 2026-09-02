// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The identity tables' rules, against real Postgres — because every one of them
 * is a database guarantee and nothing else. An application-level check would
 * pass this file while leaving the constraint absent, which is the failure this
 * exists to catch.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 * Decision: ADR-128 §11
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { IdentityMatchRepository } from "../repositories/governanceIdentity.repository";
import {
  recordGovernanceTenantUse,
  resolveGovOrganizationId,
  resolveGovTenantIds,
} from "../services/governanceTenantHistory.service";
import { isOpenLinkViolation } from "../services/logic/postgresConstraintErrors";

const ns = `gov-identity-${nanoid(8)}`;
const organizationId = `org_${ns}`;
const otherOrganizationId = `org_other_${ns}`;
const discoveredPersonId = `dp_${ns}`;

/** Postgres's unique-constraint violation. Asserted by code, never by prose. */
const UNIQUE_VIOLATION = "23505";
/** Postgres's check-constraint violation. */
const CHECK_VIOLATION = "23514";

/**
 * The Postgres SQLSTATE behind a Prisma failure.
 *
 * Prisma reports a constraint it has no code of its own for as `P2039` and puts
 * the driver's error underneath, so reading `error.code` alone would assert on
 * Prisma's "something happened" wrapper and pass whether the constraint exists
 * or not. This walks the cause chain to the code the database actually raised.
 */
const sqlState = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const code = record.code;
    // Postgres SQLSTATEs are five characters; Prisma's own codes start with P.
    if (
      typeof code === "string" &&
      /^[0-9A-Z]{5}$/.test(code) &&
      code[0] !== "P"
    ) {
      return code;
    }
    const meta = record.meta;
    if (meta && typeof meta === "object") {
      const metaCode = (meta as Record<string, unknown>).code;
      if (typeof metaCode === "string" && metaCode[0] !== "P") return metaCode;
    }
    current =
      record.cause ?? (meta as Record<string, unknown> | undefined)?.cause;
  }
  // Last resort: the message carries the SQLSTATE when the chain does not.
  const message = String((error as { message?: string })?.message ?? "");
  return /\b(23505|23514)\b/.exec(message)?.[1];
};

const link = (overrides: {
  id: string;
  validFrom: Date;
  validTo?: Date | null;
}) => ({
  id: overrides.id,
  organizationId,
  discoveredPersonId,
  userId: `user_${ns}`,
  evidenceKind: "verified_email",
  validFrom: overrides.validFrom,
  validTo: overrides.validTo ?? null,
});

describe("Feature: the identity tables hold their own rules", () => {
  beforeAll(async () => {
    await prisma.discoveredPerson.create({
      data: {
        id: discoveredPersonId,
        organizationId,
        provider: "anthropic_admin",
        rawActorId: `person-${ns}@acme.test`,
        displayText: "Person Under Test",
        kind: "person",
        firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.identityMatch.deleteMany({ where: { organizationId } });
    await prisma.discoveredPerson.deleteMany({ where: { organizationId } });
    await prisma.erasedIdentifierSuppression.deleteMany({
      where: { organizationId },
    });
    await prisma.governanceTenantHistory.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } },
    });
  });

  describe("given a provider-named person already linked to an account", () => {
    beforeAll(async () => {
      await prisma.identityMatch.create({
        data: link({
          id: `im_open_${ns}`,
          validFrom: new Date("2026-03-03T00:00:00.000Z"),
        }),
      });
    });

    describe("when a second link is opened while the first is open", () => {
      /** @scenario "A person can only have one open link at a time" */
      it("is refused as a duplicate open link", async () => {
        let caught: unknown;
        try {
          await prisma.identityMatch.create({
            data: link({
              id: `im_second_${ns}`,
              validFrom: new Date("2026-05-01T00:00:00.000Z"),
            }),
          });
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeDefined();
        // The partial unique index on open links is the only uniqueness rule
        // left after ADR-128 dropped the gist exclusion constraint (nothing
        // ever writes validTo, so overlap degenerated to "at most one open
        // link per person"). Prisma wraps its 23505 as P2002 and keeps the
        // SQLSTATE to itself, so the assertion is the application's own
        // predicate — the exact contract the service's catch sites rely on.
        expect((caught as { code?: string }).code).toBe("P2002");
        expect(isOpenLinkViolation(caught)).toBe(true);
      });
    });

    describe("when a second open link is written straight to the database", () => {
      /** @scenario "A second open link is refused even when written straight to the database" */
      it("is refused by the database itself, not by application code", async () => {
        let caught: unknown;
        try {
          // Raw SQL on purpose: this proves the rule holds for a writer that
          // skips Prisma and the service layer entirely.
          await prisma.$executeRawUnsafe(
            `
            -- @tenancy: single fixed test row; the rule under test is per-person,
            -- not per-tenant.
            INSERT INTO "IdentityMatch"
              ("id", "organizationId", "discoveredPersonId", "userId", "evidenceKind", "validFrom", "validTo")
            VALUES ($1, $2, $3, $4, 'verified_email', '2026-05-02T00:00:00Z', NULL)
            `,
            `im_raw_${ns}`,
            organizationId,
            discoveredPersonId,
            `user_${ns}`,
          );
        } catch (error) {
          caught = error;
        }

        expect(sqlState(caught)).toBe(UNIQUE_VIOLATION);

        // And the invariant itself: no person holds two open links.
        const doubled = await prisma.$queryRawUnsafe<unknown[]>(`
          -- @tenancy: invariant sweep across the whole test database; a second
          -- open link anywhere is a failure regardless of tenant.
          SELECT "discoveredPersonId", count(*)
          FROM "IdentityMatch"
          WHERE "validTo" IS NULL
          GROUP BY 1
          HAVING count(*) > 1
        `);
        expect(doubled).toHaveLength(0);
      });
    });

    describe("when a closed link overlapping the open one is written", () => {
      it("is accepted: the rule only counts open links", async () => {
        // Boundary made explicit by the spec: nothing in the product closes
        // links yet, so an overlapping closed row cannot occur outside a test.
        // Revisit when closing links ships.
        await prisma.identityMatch.create({
          data: link({
            id: `im_overlap_${ns}`,
            validFrom: new Date("2026-04-01T00:00:00.000Z"),
            validTo: new Date("2026-04-30T00:00:00.000Z"),
          }),
        });

        const rows = await prisma.identityMatch.findMany({
          where: { organizationId, discoveredPersonId },
        });
        expect(rows.map((row) => row.id)).toContain(`im_overlap_${ns}`);
      });
    });

    describe("when a link whose start and end are the same instant is saved", () => {
      /** @scenario "A link that covers no time at all is refused" */
      it("is refused, rather than slipping past the open-link rule as a closed row", async () => {
        let caught: unknown;
        try {
          await prisma.identityMatch.create({
            data: link({
              id: `im_zero_${ns}`,
              validFrom: new Date("2027-01-01T00:00:00.000Z"),
              validTo: new Date("2027-01-01T00:00:00.000Z"),
            }),
          });
        } catch (error) {
          caught = error;
        }

        expect(sqlState(caught)).toBe(CHECK_VIOLATION);
      });
    });

    describe("when a link whose end is earlier than its start is saved", () => {
      /** @scenario "A link that ends before it starts is refused" */
      it("is refused by a named condition rather than a raw type error", async () => {
        let caught: unknown;
        try {
          await prisma.identityMatch.create({
            data: link({
              id: `im_inverted_${ns}`,
              validFrom: new Date("2027-03-01T00:00:00.000Z"),
              validTo: new Date("2027-02-01T00:00:00.000Z"),
            }),
          });
        } catch (error) {
          caught = error;
        }

        expect(sqlState(caught)).toBe(CHECK_VIOLATION);
      });
    });
  });

  describe("given a person whose earlier link was closed when they left", () => {
    const leaverPersonId = `dp_leaver_${ns}`;

    beforeAll(async () => {
      await prisma.discoveredPerson.create({
        data: {
          id: leaverPersonId,
          organizationId,
          provider: "anthropic_admin",
          rawActorId: `leaver-${ns}@acme.test`,
          displayText: "Leaver",
          kind: "person",
          firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      });
      await prisma.identityMatch.create({
        data: {
          id: `im_closed_${ns}`,
          organizationId,
          discoveredPersonId: leaverPersonId,
          userId: `user_leaver_${ns}`,
          evidenceKind: "verified_email",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validTo: new Date("2026-06-01T00:00:00.000Z"),
        },
      });
    });

    describe("when a new link is opened starting after the old one closed", () => {
      /** @scenario "A closed link and a new one for the same person can coexist" */
      it("keeps both, so last year's spend stays with last year's person", async () => {
        await prisma.identityMatch.create({
          data: {
            id: `im_rehire_${ns}`,
            organizationId,
            discoveredPersonId: leaverPersonId,
            userId: `user_newhire_${ns}`,
            evidenceKind: "verified_email",
            validFrom: new Date("2026-06-01T00:00:00.000Z"),
            validTo: null,
          },
        });

        const links = await prisma.identityMatch.findMany({
          where: { organizationId, discoveredPersonId: leaverPersonId },
          orderBy: { validFrom: "asc" },
        });

        expect(links).toHaveLength(2);
        expect(links[0]?.userId).toBe(`user_leaver_${ns}`);
        expect(links[1]?.userId).toBe(`user_newhire_${ns}`);
      });
    });

    describe("when that person is erased", () => {
      /** @scenario "The link's dates survive the erasure" */
      it("keeps both links with the dates they always had, holding no account", async () => {
        const before = await prisma.identityMatch.findMany({
          where: { organizationId, discoveredPersonId: leaverPersonId },
          orderBy: { validFrom: "asc" },
        });

        await new IdentityMatchRepository().blankUserReferences(prisma, {
          organizationId,
          discoveredPersonId: leaverPersonId,
        });

        const after = await prisma.identityMatch.findMany({
          where: { organizationId, discoveredPersonId: leaverPersonId },
          orderBy: { validFrom: "asc" },
        });

        // Same rows, same dates. Closing or deleting them would rewrite the
        // past to claim the link never existed; the erasure removes the
        // identifier, not the history.
        expect(after).toHaveLength(before.length);
        expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
        expect(after.map((row) => row.validFrom)).toEqual(
          before.map((row) => row.validFrom),
        );
        expect(after.map((row) => row.validTo)).toEqual(
          before.map((row) => row.validTo),
        );
        expect(after.every((row) => row.userId === null)).toBe(true);
      });
    });
  });

  describe("given the suppression list", () => {
    it("accepts the same digest under two providers, and refuses it twice under one", async () => {
      const identifierHash = "a".repeat(64);
      await prisma.erasedIdentifierSuppression.createMany({
        data: [
          {
            organizationId,
            provider: "anthropic_admin",
            identifierHash,
            erasedAt: new Date(),
          },
          {
            organizationId,
            provider: "openai_admin",
            identifierHash,
            erasedAt: new Date(),
          },
        ],
      });

      const rows = await prisma.erasedIdentifierSuppression.findMany({
        where: { organizationId, identifierHash },
      });
      expect(rows).toHaveLength(2);

      // Re-erasing the same person is a normal operation, not a fault.
      const again = await prisma.erasedIdentifierSuppression.createMany({
        data: [
          {
            organizationId,
            provider: "anthropic_admin",
            identifierHash,
            erasedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      expect(again.count).toBe(0);
    });
  });
});

describe("Feature: an organization's governance areas are remembered", () => {
  const historyOrg = `org_hist_${nanoid(8)}`;

  afterAll(async () => {
    await prisma.governanceTenantHistory.deleteMany({
      where: { organizationId: historyOrg },
    });
  });

  describe("given an organization that used one governance area and then another", () => {
    beforeAll(async () => {
      await recordGovernanceTenantUse({
        prisma,
        organizationId: historyOrg,
        tenantId: `project_gov_old_${historyOrg}`,
        at: new Date("2026-01-01T00:00:00.000Z"),
      });
      await recordGovernanceTenantUse({
        prisma,
        organizationId: historyOrg,
        tenantId: `project_gov_new_${historyOrg}`,
        at: new Date("2026-07-01T00:00:00.000Z"),
      });
      // Re-resolving the current one must not add a third row.
      await recordGovernanceTenantUse({
        prisma,
        organizationId: historyOrg,
        tenantId: `project_gov_new_${historyOrg}`,
        at: new Date("2026-08-01T00:00:00.000Z"),
      });
    });

    describe("when the whole history is asked for", () => {
      /** @scenario "Areas the organization used before today are still found after one is retired" */
      it("returns both areas, oldest first", async () => {
        await expect(
          resolveGovTenantIds({ prisma, organizationId: historyOrg }),
        ).resolves.toEqual([
          `project_gov_old_${historyOrg}`,
          `project_gov_new_${historyOrg}`,
        ]);
      });
    });

    describe("when a caller holds a retired area id", () => {
      it("still translates it back to the organization", async () => {
        await expect(
          resolveGovOrganizationId({
            prisma,
            tenantId: `project_gov_old_${historyOrg}`,
          }),
        ).resolves.toBe(historyOrg);
      });
    });
  });
});

/**
 * The migration's own backfill statement, run against rows that look like an
 * organization which ingested before any of this existed.
 *
 * Load-bearing rather than belt-and-braces: without the backfill the history is
 * empty for every organization already in production, so the first erasure
 * after the migration resolves zero areas, deletes nothing, and reports success
 * — the exact silent failure the table exists to prevent. The statement is
 * re-run here (it is idempotent by its ON CONFLICT) rather than asserted from
 * whatever the deployed migration happened to leave behind, so a change to the
 * SQL is what breaks this test.
 */
describe("Feature: organizations that already ingested are backfilled", () => {
  const backfillNs = nanoid(8);
  let backfillOrg: string;
  let liveGovernanceId: string;
  let retiredGovernanceId: string;
  let ordinaryProjectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Backfill Org", slug: `--test-backfill-${backfillNs}` },
    });
    backfillOrg = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Backfill Team",
        slug: `--test-backfill-team-${backfillNs}`,
        organizationId: organization.id,
      },
    });

    const makeProject = async (args: {
      slug: string;
      kind: string;
      archivedAt: Date | null;
    }) =>
      (
        await prisma.project.create({
          data: {
            name: args.slug,
            slug: args.slug,
            apiKey: args.slug,
            teamId: team.id,
            kind: args.kind,
            language: "internal",
            framework: "governance",
            archivedAt: args.archivedAt,
          },
        })
      ).id;

    liveGovernanceId = await makeProject({
      slug: `--test-backfill-gov-live-${backfillNs}`,
      kind: "internal_governance",
      archivedAt: null,
    });
    retiredGovernanceId = await makeProject({
      slug: `--test-backfill-gov-retired-${backfillNs}`,
      kind: "internal_governance",
      archivedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    ordinaryProjectId = await makeProject({
      slug: `--test-backfill-app-${backfillNs}`,
      kind: "application",
      archivedAt: null,
    });
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["governanceTenantHistory", { organizationId: backfillOrg }],
      [
        "project",
        {
          id: {
            in: [liveGovernanceId, retiredGovernanceId, ordinaryProjectId],
          },
        },
      ],
      ["team", { organizationId: backfillOrg }],
      ["organization", { id: backfillOrg }],
    ]),
  );

  describe("given organizations that ingested before any of this was recorded", () => {
    /** @scenario "Organizations that already ingested keep their area when the records are introduced" */
    it("puts each existing area in the history, retired ones included", async () => {
      await prisma.$executeRawUnsafe(`
        -- @tenancy: this IS the migration's own statement, and the migration
        -- backfills every organization at once. Narrowing it to one tenant
        -- would test a query the migration does not run.
        INSERT INTO "GovernanceTenantHistory" ("id", "organizationId", "tenantId", "firstUsedAt", "lastUsedAt")
        SELECT
            'gth_' || replace(gen_random_uuid()::text, '-', ''),
            "Team"."organizationId",
            "Project"."id",
            "Project"."createdAt",
            "Project"."updatedAt"
        FROM "Project"
        JOIN "Team" ON "Team"."id" = "Project"."teamId"
        WHERE "Project"."kind" = 'internal_governance'
        ON CONFLICT ("organizationId", "tenantId") DO NOTHING
      `);

      const recorded = await resolveGovTenantIds({
        prisma,
        organizationId: backfillOrg,
      });

      expect(recorded).toContain(liveGovernanceId);
      // A retired area still holds the rows written under it, and reaching
      // them is the entire point.
      expect(recorded).toContain(retiredGovernanceId);
      expect(recorded).not.toContain(ordinaryProjectId);
    });
  });
});
