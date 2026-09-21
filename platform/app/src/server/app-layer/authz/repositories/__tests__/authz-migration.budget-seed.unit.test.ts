/** @vitest-environment node */

/**
 * The view-budget handover the authz-engine migration runs on every pass, and
 * the read that pairs with it. Both scale with an organization's share links,
 * which is what made a 428k-link organization unable to finish a pass at all.
 *
 * Prisma is a stub, so nothing here opens a socket. The guard is asserted as
 * SQL because that is what it is; whether Postgres honours it is the
 * integration lane's question.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { PrismaAuthzMigrationRepository } from "../authz-migration.prisma.repository";

const ORG = "org_acme";

function build() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = { $executeRaw: executeRaw } as never;
  return {
    executeRaw,
    repository: new PrismaAuthzMigrationRepository(prisma),
  };
}

/** The statement itself, flattened to one comparable string. */
function statement(executeRaw: Mock, call = 0): string {
  const strings = executeRaw.mock.calls[call]?.[0] as unknown as string[];
  return strings.join("?").replace(/\s+/g, " ");
}

/** The seed rows the statement carries, as their bound values. */
function boundValues(executeRaw: Mock, call = 0): unknown[] {
  const rows = executeRaw.mock.calls[call]?.[1] as Prisma.Sql;
  return rows.values;
}

function seeds(count: number, viewCount = 1) {
  return Array.from({ length: count }, (_, index) => ({
    grantId: `share_${index}`,
    projectId: "project_1",
    viewCount,
  }));
}

describe("PrismaAuthzMigrationRepository budget seeding", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given an organization's share links", () => {
    describe("when the budgets are seeded", () => {
      it("states every seed in one statement, not one statement per seed", async () => {
        const { repository, executeRaw } = build();

        await repository.seedResourceGrantUsage({
          organizationId: ORG,
          seeds: seeds(400),
        });

        expect(executeRaw).toHaveBeenCalledTimes(1);
        expect(boundValues(executeRaw)).toHaveLength(400 * 4);
      });

      it("chunks past the parameter ceiling instead of growing one statement", async () => {
        const { repository, executeRaw } = build();

        await repository.seedResourceGrantUsage({
          organizationId: ORG,
          seeds: seeds(5_001),
        });

        expect(executeRaw).toHaveBeenCalledTimes(2);
        // Both chunks, or a statement could drop rows and still count right.
        expect(boundValues(executeRaw, 0)).toHaveLength(5_000 * 4);
        expect(boundValues(executeRaw, 1)).toHaveLength(1 * 4);
      });

      it("says nothing at all for an organization with no share links", async () => {
        const { repository, executeRaw } = build();

        await repository.seedResourceGrantUsage({
          organizationId: ORG,
          seeds: [],
        });

        expect(executeRaw).not.toHaveBeenCalled();
      });
    });

    describe("when the seeded budgets are read back", () => {
      it("reads them for the organization, never one parameter per link", async () => {
        // Postgres binds at most 65535 parameters in a statement, so naming
        // every grant fails outright at exactly the size where this migration
        // is hardest - and only once the organization has heads to compare,
        // never on the empty first pass that would have shown it.
        const grantFindMany = vi.fn().mockResolvedValue(
          Array.from({ length: 70_000 }, (_, index) => ({
            id: `share_${index}`,
            source: "migration",
            token: null,
            resourceKind: "trace",
            scopeId: "trace_1",
            projectId: "project_1",
            principalType: "ANYONE",
            principalId: null,
            expiresAt: null,
            maxViews: null,
          })),
        );
        const usageFindMany = vi.fn().mockResolvedValue([]);
        const repository = new PrismaAuthzMigrationRepository({
          grant: { findMany: grantFindMany },
          grantUsage: { findMany: usageFindMany },
        } as never);

        await repository.findResourceGrantRows({ organizationId: ORG });

        // Both halves: the shape of the read, and that there is only one of
        // it. `toHaveBeenCalledWith` alone passes just as happily on an
        // implementation that adds a second, per-link read beside it.
        expect(usageFindMany).toHaveBeenCalledTimes(1);
        expect(usageFindMany).toHaveBeenCalledWith({
          where: { organizationId: ORG },
          select: { grantId: true, viewCount: true },
        });
      });
    });

    describe("when a seed would lower a budget", () => {
      // Views are never refunded (decision 22). The guard lives in the UPDATE
      // itself rather than a filter resolved by an earlier SELECT, so a
      // consume landing mid-flight cannot be walked back.
      /** @scenario "A view budget is raised on a re-run, never lowered" */
      it("raises only where the seed is strictly higher", async () => {
        const { repository, executeRaw } = build();

        await repository.seedResourceGrantUsage({
          organizationId: ORG,
          seeds: seeds(1),
        });

        const sql = statement(executeRaw);
        expect(sql).toContain('ON CONFLICT ("grantId") DO UPDATE');
        expect(sql).toContain(
          'WHERE "GrantUsage"."viewCount" < EXCLUDED."viewCount"',
        );
      });

      /** @scenario "A view budget is raised on a re-run, never lowered" */
      it("leaves a usage row that disagrees about where it lives alone", async () => {
        const { repository, executeRaw } = build();

        await repository.seedResourceGrantUsage({
          organizationId: ORG,
          seeds: seeds(1),
        });

        const sql = statement(executeRaw);
        expect(sql).toContain(
          'AND "GrantUsage"."organizationId" = EXCLUDED."organizationId"',
        );
        expect(sql).toContain(
          'AND "GrantUsage"."projectId" = EXCLUDED."projectId"',
        );
      });
    });
  });
});
