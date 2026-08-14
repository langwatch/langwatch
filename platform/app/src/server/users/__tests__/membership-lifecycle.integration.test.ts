/**
 * @vitest-environment node
 *
 * The lifecycle hook's unit tests run against an in-memory Prisma stand-in, so
 * they cannot see the organization-tenancy guard (`ORG_SCOPED_MODELS`), which
 * only exists on the real client. `OrganizationUser` is a guarded model and
 * this hook queries it deliberately WITHOUT an organizationId — counting a
 * person's remaining memberships across every organization is the whole of the
 * last-membership rule — so whether the guard admits that query is a question
 * only the real client can answer, and getting it wrong 500s every offboarding.
 *
 * ADR-094 Decision 4.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrganizationUserRole } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { MembershipLifecycleService } from "../membership-lifecycle.service";

const ns = nanoid(8);
const OFFBOARDED_AT = new Date("2026-06-01T00:00:00Z");

let orgAId: string;
let orgBId: string;
let userId: string;

const membership = (organizationId: string) =>
  prisma.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });

beforeAll(async () => {
  // The last-membership escalation revokes sessions and CLI tokens, which
  // reach for the App. Running them for real is the point: they are the half
  // of deactivation that lives in Redis, outside the transaction.
  await resetApp();
  globalForApp.__langwatch_app = createTestApp();

  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({
      data: { name: "Lifecycle A", slug: `--test-org-lc-a-${ns}` },
    }),
    prisma.organization.create({
      data: { name: "Lifecycle B", slug: `--test-org-lc-b-${ns}` },
    }),
  ]);
  orgAId = orgA.id;
  orgBId = orgB.id;

  const user = await prisma.user.create({
    data: { name: "Two Orgs", email: `lifecycle-${ns}@example.com` },
  });
  userId = user.id;

  await prisma.organizationUser.createMany({
    data: [
      { userId, organizationId: orgAId, role: OrganizationUserRole.MEMBER },
      { userId, organizationId: orgBId, role: OrganizationUserRole.MEMBER },
    ],
  });
});

afterAll(() =>
  // Per organization, not by user: `OrganizationUser` is tenancy-guarded, so a
  // delete that names no organization is refused — the same guard this suite
  // exists to prove the hook satisfies.
  cleanupTestRows(prisma, [
    ["organizationUser", { organizationId: orgAId }],
    ["organizationUser", { organizationId: orgBId }],
    ["organization", { id: orgAId }],
    ["organization", { id: orgBId }],
    ["user", { id: userId }],
  ]),
);

describe("MembershipLifecycleService against a real database", () => {
  describe("given a person who belongs to two organizations", () => {
    it("disables only the organization that offboarded them, and leaves the account alone", async () => {
      const service = MembershipLifecycleService.create(prisma);

      const outcome = await service.onMembershipDeactivated({
        organizationId: orgAId,
        userId,
        now: OFFBOARDED_AT,
      });

      expect(outcome.globallyDeactivated).toBe(false);
      expect((await membership(orgAId))?.disabledAt).toEqual(OFFBOARDED_AT);
      expect((await membership(orgBId))?.disabledAt).toBeNull();
      expect(
        (await prisma.user.findUnique({ where: { id: userId } }))
          ?.deactivatedAt,
      ).toBeNull();
    });

    it("turns the account off when the second organization goes", async () => {
      const service = MembershipLifecycleService.create(prisma);

      const outcome = await service.onMembershipDeactivated({
        organizationId: orgBId,
        userId,
        now: OFFBOARDED_AT,
      });

      expect(outcome.globallyDeactivated).toBe(true);
      expect(
        (await prisma.user.findUnique({ where: { id: userId } }))
          ?.deactivatedAt,
      ).toEqual(OFFBOARDED_AT);
    });

    it("puts one membership back without touching the other", async () => {
      const service = MembershipLifecycleService.create(prisma);

      await service.onMembershipReactivated({
        organizationId: orgAId,
        userId,
      });

      expect((await membership(orgAId))?.disabledAt).toBeNull();
      expect((await membership(orgBId))?.disabledAt).toEqual(OFFBOARDED_AT);
      expect(
        (await prisma.user.findUnique({ where: { id: userId } }))
          ?.deactivatedAt,
      ).toBeNull();
    });
  });

  describe("when both organizations offboard the person at the same moment", () => {
    /**
     * Two directories can withdraw a person's last two memberships
     * concurrently, and under READ COMMITTED each transaction counts
     * memberships before the other commits — so both can see one left and
     * neither escalates, leaving a live account with no memberships.
     *
     * The interleaving is not forced here, because forcing it needs two
     * connections held open at chosen points and the harness has one client.
     * What is deterministic is the OUTCOME: whether or not the race happens on
     * a given run, the account must end up off. Without the post-commit
     * re-check this assertion fails whenever the race does occur, and passes
     * otherwise — which is precisely the flake a real deployment shows.
     */
    it("still turns the account off, whichever of them commits last", async () => {
      const service = MembershipLifecycleService.create(prisma);
      await service.onMembershipReactivated({
        organizationId: orgAId,
        userId,
      });
      await service.onMembershipReactivated({
        organizationId: orgBId,
        userId,
      });

      await Promise.all([
        service.onMembershipDeactivated({
          organizationId: orgAId,
          userId,
          now: OFFBOARDED_AT,
        }),
        service.onMembershipDeactivated({
          organizationId: orgBId,
          userId,
          now: OFFBOARDED_AT,
        }),
      ]);

      expect((await membership(orgAId))?.disabledAt).toEqual(OFFBOARDED_AT);
      expect((await membership(orgBId))?.disabledAt).toEqual(OFFBOARDED_AT);
      expect(
        (await prisma.user.findUnique({ where: { id: userId } }))
          ?.deactivatedAt,
      ).not.toBeNull();
    });
  });
});
