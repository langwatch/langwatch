/**
 * @vitest-environment node
 *
 * Acceptance for the guarded teardown (#6219), against real Postgres.
 *
 * The property under test: a suite whose beforeAll threw before assigning
 * its ids must be provably unable to delete rows it did not create. The
 * "bystander" organization below stands in for every other suite and
 * worktree sharing the local test database.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 *
 * Spec: specs/setup/test-teardown-safety.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "../cleanup-test-rows";

/**
 * The tenancy guard names a project/organization on every query. This suite
 * writes and deletes rows across organizations that do not otherwise relate
 * to one another, so it composes the client without a guard rather than
 * teaching one about a scope that does not apply here.
 */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ns = `cleanup-guard-${nanoid(8)}`;

describe.skipIf(!DB_URL)("cleanupTestRows (real DB)", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;

  // Module-level consts: these cannot be undefined, so the suite's own
  // teardown is immune to the very collapse it tests.
  const bystanderOrgId = `org_${nanoid(12)}`;
  const bystanderTeamId = `team_${nanoid(12)}`;
  const suiteOrgId = `org_${nanoid(12)}`;
  // FeatureFlag is deliberately the exempt-model case. Organization and Team
  // sit in the tenancy regimes, whose middleware happens to reject a
  // collapsed `{}` filter at runtime; FeatureFlag is in GLOBAL_MODELS with
  // no FK pointing at it, so nothing but this helper stands between an
  // unassigned id and a full-table sweep. That makes it the honest probe.
  const bystanderFlagKey = `bystander-flag-${ns}`;

  beforeAll(async () => {
    connection = PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
    );
    prisma = connection.client as PrismaClient;

    // Rows this suite does NOT own in spirit: they model another suite's
    // data sharing the same database.
    await prisma.organization.create({
      data: {
        id: bystanderOrgId,
        name: `Bystander Org ${ns}`,
        slug: `--bystander-${ns}`,
      },
    });
    await prisma.team.create({
      data: {
        id: bystanderTeamId,
        name: `Bystander Team ${ns}`,
        slug: `--bystander-team-${ns}`,
        organizationId: bystanderOrgId,
      },
    });

    // A row the failing-teardown scenarios legitimately created before
    // their imagined setup broke.
    await prisma.organization.create({
      data: {
        id: suiteOrgId,
        name: `Suite Org ${ns}`,
        slug: `--suite-${ns}`,
      },
    });

    await prisma.featureFlag.create({
      data: { key: bystanderFlagKey, enabled: false },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupTestRows(prisma, [
      ["team", { id: bystanderTeamId }],
      ["organization", { id: { in: [bystanderOrgId, suiteOrgId] } }],
      ["featureFlag", { key: bystanderFlagKey }],
    ]);
    await prisma.$disconnect();
  });

  describe("given a teardown whose ids were never assigned", () => {
    // The shape every integration suite uses: a let assigned inside
    // beforeAll. Here the assignment "never happened".
    let neverAssignedOrgId!: string;
    let neverAssignedTeamId!: string;

    /** @scenario "Rows the suite did not create survive a broken setup" */
    it("cannot delete rows it did not create, and says why", async () => {
      await expect(
        cleanupTestRows(prisma!, [
          ["team", { id: neverAssignedTeamId }],
          ["organization", { id: neverAssignedOrgId }],
        ]),
      ).rejects.toThrow(/organization\[1\]\.where\.id is undefined/);

      // The bystanders, the rows the raw form would have swept, survive.
      expect(
        await prisma!.organization.findUnique({
          where: { id: bystanderOrgId },
        }),
      ).not.toBeNull();
      expect(
        await prisma!.team.findUnique({ where: { id: bystanderTeamId } }),
      ).not.toBeNull();
    });

    /** @scenario "Rows the suite did not create survive a broken setup" */
    it("cannot sweep a model that nothing else protects", async () => {
      // Organization and Team collapses get incidentally stopped by the
      // tenancy middleware or an FK; FeatureFlag has neither. On this
      // model the helper's refusal is the only thing between an
      // unassigned id and deleting every row.
      let neverAssignedFlagKey!: string;

      await expect(
        cleanupTestRows(prisma!, [["featureFlag", { key: neverAssignedFlagKey }]]),
      ).rejects.toThrow(/featureFlag\[0\]\.where\.key is undefined/);

      expect(
        await prisma!.featureFlag.findUnique({
          where: { key: bystanderFlagKey },
        }),
      ).not.toBeNull();
    });

    /** @scenario "The identifiable entries are still cleaned" */
    it("still cleans the entries that are identified", async () => {
      const doomedId = `org_${nanoid(12)}`;
      await prisma!.organization.create({
        data: {
          id: doomedId,
          name: `Doomed Org ${ns}`,
          slug: `--doomed-${ns}`,
        },
      });

      await expect(
        cleanupTestRows(prisma!, [
          ["organization", { id: doomedId }],
          ["team", { id: neverAssignedTeamId }],
        ]),
      ).rejects.toThrow(/team\[1\]\.where\.id is undefined/);

      // The identified entry was cleaned...
      expect(
        await prisma!.organization.findUnique({ where: { id: doomedId } }),
      ).toBeNull();
      // ...and the unidentified one deleted nothing.
      expect(
        await prisma!.team.findUnique({ where: { id: bystanderTeamId } }),
      ).not.toBeNull();
    });
  });

  describe("given a teardown whose ids were all assigned", () => {
    /** @scenario "A fully identified teardown just cleans up" */
    it("deletes exactly the matching rows and resolves", async () => {
      const ownId = `org_${nanoid(12)}`;
      await prisma!.organization.create({
        data: {
          id: ownId,
          name: `Owned Org ${ns}`,
          slug: `--owned-${ns}`,
        },
      });

      await expect(
        cleanupTestRows(prisma!, [["organization", { id: ownId }]]),
      ).resolves.toBeUndefined();

      expect(
        await prisma!.organization.findUnique({ where: { id: ownId } }),
      ).toBeNull();
      expect(
        await prisma!.organization.findUnique({
          where: { id: bystanderOrgId },
        }),
      ).not.toBeNull();
    });
  });

  describe("given a delete that the database refuses", () => {
    /** @scenario "A delete that fails is reported, not hidden" */
    it("reports the failure and still cleans the remaining entries", async () => {
      const survivorId = `org_${nanoid(12)}`;
      await prisma!.organization.create({
        data: {
          id: survivorId,
          name: `Survivor Org ${ns}`,
          slug: `--survivor-${ns}`,
        },
      });

      // Deleting the bystander org while its team still references it
      // violates the FK, which is a real failing delete, not a stub.
      await expect(
        cleanupTestRows(prisma!, [
          ["organization", { id: bystanderOrgId }],
          ["organization", { id: survivorId }],
        ]),
      ).rejects.toThrow(/organization\.deleteMany failed/);

      // The failure did not stop the rest of the cleanup.
      expect(
        await prisma!.organization.findUnique({ where: { id: survivorId } }),
      ).toBeNull();
      // And the FK held: the bystander is still there.
      expect(
        await prisma!.organization.findUnique({
          where: { id: bystanderOrgId },
        }),
      ).not.toBeNull();
    });
  });
});
