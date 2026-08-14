/**
 * @vitest-environment node
 *
 * The admin link surface, exercised through tRPC rather than through the
 * service — because the properties the ADR's Gates table names are properties
 * of the ENDPOINT, not of the service behind it. "The actor comes from the
 * session, never the request body" is only true if the router refuses to read
 * one from the body, and a service test can never see that.
 *
 * ADR-094 Decision 3 / Gates "Link create / unlink (tRPC)".
 */

import { FREE_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };
const ns = `attr-${nanoid(8)}`;
const JANUARY = new Date("2026-01-01T00:00:00Z");

let organizationId: string;
let otherOrganizationId: string;
let adminUserId: string;
let memberUserId: string;
let linkedUserId: string;
let connectionId: string;
let foreignConnectionId: string;

const login = () => ({
  provider: "anthropic",
  providerConnectionId: connectionId,
  externalKind: "member_id",
  externalId: `mem-${ns}`,
});

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" } as never,
    }),
  );

const seedOrganization = async (label: string) => {
  const organization = await prisma.organization.create({
    data: { name: `Attr ${label} ${ns}`, slug: `--attr-${label}-${ns}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `Attr ${label} Team ${ns}`,
      slug: `--attr-${label}-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const connection = await prisma.ingestionSource.create({
    data: {
      organizationId: organization.id,
      sourceType: "claude_compliance",
      name: `Attr ${label} Connection ${ns}`,
      ingestSecretHash: "unused-by-this-suite",
    },
  });
  return { organization, team, connection };
};

const grant = async ({
  userId,
  organizationId: orgId,
  teamId,
  role,
}: {
  userId: string;
  organizationId: string;
  teamId: string;
  role: OrganizationUserRole;
}) => {
  await prisma.organizationUser.create({
    data: { userId, organizationId: orgId, role },
  });
  const teamRole =
    role === OrganizationUserRole.ADMIN ? TeamUserRole.ADMIN : TeamUserRole.MEMBER;
  await prisma.teamUser.create({ data: { userId, teamId, role: teamRole } });
  await prisma.roleBinding.create({
    data: {
      organizationId: orgId,
      userId,
      role: teamRole,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: orgId,
    },
  });
};

beforeAll(async () => {
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => enterprisePlan,
    }),
  });

  const home = await seedOrganization("home");
  const foreign = await seedOrganization("foreign");
  organizationId = home.organization.id;
  otherOrganizationId = foreign.organization.id;
  connectionId = home.connection.id;
  foreignConnectionId = foreign.connection.id;

  const [admin, member, linked] = await Promise.all([
    prisma.user.create({
      data: { name: "Attr Admin", email: `attr-admin-${ns}@example.com` },
    }),
    prisma.user.create({
      data: { name: "Attr Member", email: `attr-member-${ns}@example.com` },
    }),
    prisma.user.create({
      data: { name: "Attr Linked", email: `attr-linked-${ns}@example.com` },
    }),
  ]);
  adminUserId = admin.id;
  memberUserId = member.id;
  linkedUserId = linked.id;

  await grant({
    userId: adminUserId,
    organizationId,
    teamId: home.team.id,
    role: OrganizationUserRole.ADMIN,
  });
  await grant({
    userId: memberUserId,
    organizationId,
    teamId: home.team.id,
    role: OrganizationUserRole.MEMBER,
  });
  await grant({
    userId: linkedUserId,
    organizationId,
    teamId: home.team.id,
    role: OrganizationUserRole.MEMBER,
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["providerIdentityLink", { organizationId }],
    ["providerIdentityLink", { organizationId: otherOrganizationId }],
    ["attributionReportExport", { organizationId }],
    ["ingestionSource", { organizationId }],
    ["ingestionSource", { organizationId: otherOrganizationId }],
    ["roleBinding", { organizationId }],
    ["teamUser", { team: { organizationId } }],
    ["organizationUser", { organizationId }],
    ["team", { organizationId }],
    ["team", { organizationId: otherOrganizationId }],
    ["organization", { id: organizationId }],
    ["organization", { id: otherOrganizationId }],
    [
      "user",
      { id: { in: [adminUserId, memberUserId, linkedUserId] } } as never,
    ],
  ]);
});

describe("usageAttribution router", () => {
  describe("permissions", () => {
    describe("given an org MEMBER", () => {
      it("refuses the report", async () => {
        await expect(
          callerFor(memberUserId).usageAttribution.report({
            organizationId,
            fromMs: JANUARY.getTime(),
            toMs: Date.now(),
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("refuses to append a link", async () => {
        await expect(
          callerFor(memberUserId).usageAttribution.createLink({
            organizationId,
            login: login(),
            userId: linkedUserId,
            effectiveFromMs: JANUARY.getTime(),
            source: "manual",
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("refuses the suggestions, which name people and their spend", async () => {
        await expect(
          callerFor(memberUserId).usageAttribution.suggestions({
            organizationId,
            fromMs: JANUARY.getTime(),
            toMs: Date.now(),
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });
    });
  });

  describe("given an org ADMIN appending a link", () => {
    it("stamps the actor from the session, with no way to supply one", async () => {
      const created = await callerFor(adminUserId).usageAttribution.createLink({
        organizationId,
        login: login(),
        userId: linkedUserId,
        effectiveFromMs: JANUARY.getTime(),
        source: "manual",
        // A forged actor, if the endpoint would take one. The input schema has
        // no such field, so tRPC strips it and the session's id is written.
        actorUserId: "somebody-else",
      } as never);

      expect(created.actorUserId).toBe(adminUserId);
      expect(created.userId).toBe(linkedUserId);
      expect(created.erasedAt).toBeNull();
    });

    describe("and the connection belongs to another organization", () => {
      // `providerConnectionId` is a plain column with no foreign key, so
      // nothing but this check stops one organization attributing another's
      // spend to its own people.
      it("is rejected", async () => {
        await expect(
          callerFor(adminUserId).usageAttribution.createLink({
            organizationId,
            login: { ...login(), providerConnectionId: foreignConnectionId },
            userId: linkedUserId,
            effectiveFromMs: JANUARY.getTime(),
            source: "manual",
          }),
        ).rejects.toThrow(/does not belong to organization/);
      });
    });

    describe("and the person is not a member of this organization", () => {
      it("is rejected, so a report cannot print an outsider's name", async () => {
        const outsider = await prisma.user.create({
          data: { name: "Outsider", email: `attr-outsider-${ns}@example.com` },
        });
        await expect(
          callerFor(adminUserId).usageAttribution.createLink({
            organizationId,
            login: login(),
            userId: outsider.id,
            effectiveFromMs: JANUARY.getTime(),
            source: "manual",
          }),
        ).rejects.toThrow(/not a member of organization/);
        await cleanupTestRows(prisma, [["user", { id: outsider.id }]]);
      });
    });

    describe("and an email-shaped id is typed in mixed case", () => {
      it("stores it canonically, so it matches what the provider sends", async () => {
        const created = await callerFor(
          adminUserId,
        ).usageAttribution.createLink({
          organizationId,
          login: {
            provider: "anthropic",
            providerConnectionId: connectionId,
            externalKind: "email",
            externalId: `  Mixed.Case-${ns}@Example.COM `,
          },
          userId: linkedUserId,
          effectiveFromMs: JANUARY.getTime(),
          source: "manual",
        });

        expect(created.externalId).toBe(
          `mixed.case-${ns}@example.com`.toLowerCase(),
        );
      });
    });
  });

  describe("the timeline", () => {
    it("reads newest first, and a same-instant correction wins on seq", async () => {
      const correctionLogin = {
        provider: "anthropic",
        providerConnectionId: connectionId,
        externalKind: "member_id",
        externalId: `mem-tie-${ns}`,
      };
      const caller = callerFor(adminUserId);
      await caller.usageAttribution.createLink({
        organizationId,
        login: correctionLogin,
        userId: linkedUserId,
        effectiveFromMs: JANUARY.getTime(),
        source: "manual",
      });
      await caller.usageAttribution.createLink({
        organizationId,
        login: correctionLogin,
        userId: adminUserId,
        // The SAME instant: only `seq` can break this, and the later append
        // has to win or a correction could never displace a wrong row.
        effectiveFromMs: JANUARY.getTime(),
        source: "manual",
      });

      const timeline = await caller.usageAttribution.listTimeline({
        organizationId,
        login: correctionLogin,
      });

      expect(timeline.ordering).toBe("effectiveFrom DESC, seq DESC");
      expect(timeline.rows[0]!.userId).toBe(adminUserId);
      expect(timeline.rows[1]!.userId).toBe(linkedUserId);
    });

    describe("when a link is closed", () => {
      it("appends an unlink row rather than removing anything", async () => {
        const closingLogin = {
          provider: "anthropic",
          providerConnectionId: connectionId,
          externalKind: "member_id",
          externalId: `mem-closed-${ns}`,
        };
        const caller = callerFor(adminUserId);
        await caller.usageAttribution.createLink({
          organizationId,
          login: closingLogin,
          userId: linkedUserId,
          effectiveFromMs: JANUARY.getTime(),
          source: "manual",
        });
        await caller.usageAttribution.closeLink({
          organizationId,
          login: closingLogin,
          effectiveFromMs: new Date("2026-06-01T00:00:00Z").getTime(),
        });

        const timeline = await caller.usageAttribution.listTimeline({
          organizationId,
          login: closingLogin,
        });

        expect(timeline.rows).toHaveLength(2);
        expect(timeline.rows[0]!.userId).toBeNull();
        // An unlink is not an erasure, and the two must never be confused.
        expect(timeline.rows[0]!.erasedAt).toBeNull();
        expect(timeline.rows[1]!.userId).toBe(linkedUserId);
      });
    });
  });

  describe("suggestions", () => {
    // Locked decision, not an unfinished feature: an automatic match is a
    // guess about whose money this is.
    it("write no rows of their own", async () => {
      const before = await prisma.providerIdentityLink.count({
        where: { organizationId },
      });

      await callerFor(adminUserId).usageAttribution.suggestions({
        organizationId,
        fromMs: JANUARY.getTime(),
        toMs: Date.now(),
      });

      expect(
        await prisma.providerIdentityLink.count({ where: { organizationId } }),
      ).toBe(before);
    });
  });

  describe("the export", () => {
    it("records the window against the session's actor", async () => {
      await callerFor(adminUserId).usageAttribution.exportReport({
        organizationId,
        fromMs: JANUARY.getTime(),
        toMs: new Date("2026-02-01T00:00:00Z").getTime(),
      });

      const recorded = await prisma.attributionReportExport.findFirst({
        where: { organizationId },
        orderBy: { exportedAt: "desc" },
      });
      expect(recorded?.actorUserId).toBe(adminUserId);
      expect(recorded?.periodFrom).toEqual(JANUARY);
    });

    describe("given a member tries", () => {
      it("is refused — declaring a period reported is a commitment", async () => {
        await expect(
          callerFor(memberUserId).usageAttribution.exportReport({
            organizationId,
            fromMs: JANUARY.getTime(),
            toMs: Date.now(),
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });
    });
  });
});
