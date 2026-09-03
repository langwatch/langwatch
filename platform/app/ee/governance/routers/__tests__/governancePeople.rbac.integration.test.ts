// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The People router's grants, enforced at the tRPC boundary rather than only
 * by the page: reads open on `governance:view`, and the two writes — running
 * the engine, confirming a suggestion — ask for `governance:manage`. The
 * page-level guard is a courtesy; a caller talking to tRPC directly is who
 * these tests speak for.
 *
 * Three principals, from the same production shapes governance.rbac uses:
 * an org ADMIN (holds both grants), an org MEMBER (holds neither — before
 * the RBAC drift fix this bag could read everything), and a delegated
 * VIEWER (a custom role carrying `governance:view` and nothing that manages
 * anything — the shape the delegated-governance-viewer feature ships).
 *
 * Spec: specs/governance/governance-people-screen.feature
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

// RBAC is what this file pins, not licensing — same override, same reason,
// as governance.rbac.integration.test.ts.
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

describe("governancePeople router — RBAC enforcement", () => {
  const ns = `gov-people-rbac-${nanoid(8)}`;

  let organizationId: string;
  let adminUserId: string;
  let memberUserId: string;
  let viewerUserId: string;

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => enterprisePlan,
      }),
    });

    const organization = await prisma.organization.create({
      data: { name: `People RBAC Org ${ns}`, slug: `--gp-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: `People RBAC Team ${ns}`,
        slug: `--gp-team-${ns}`,
        organizationId,
      },
    });

    const principal = async (
      name: string,
      email: string,
      orgRole: OrganizationUserRole,
      teamRole: TeamUserRole,
      customRoleId?: string,
    ) => {
      const user = await prisma.user.create({ data: { name, email } });
      await prisma.organizationUser.create({
        data: { userId: user.id, organizationId, role: orgRole },
      });
      await prisma.teamUser.create({
        data: { userId: user.id, teamId: team.id, role: teamRole },
      });
      // One binding per principal and scope. The table's check constraint
      // ties the two columns together: a customRoleId demands role CUSTOM,
      // and the custom role's permission bag then resolves instead of the
      // built-in role's.
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: user.id,
          role: customRoleId ? TeamUserRole.CUSTOM : teamRole,
          customRoleId: customRoleId ?? null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
      return user.id;
    };

    adminUserId = await principal(
      "People Admin",
      `gp-admin-${ns}@example.com`,
      OrganizationUserRole.ADMIN,
      TeamUserRole.ADMIN,
    );
    memberUserId = await principal(
      "People Member",
      `gp-member-${ns}@example.com`,
      OrganizationUserRole.MEMBER,
      TeamUserRole.MEMBER,
    );

    // The delegated viewer: a MEMBER whose custom role carries the one read
    // grant the Governance product is offered on, and nothing that manages.
    const viewerRole = await prisma.customRole.create({
      data: {
        organizationId,
        name: `Governance viewer ${ns}`,
        permissions: ["organization:view", "governance:view"],
      },
    });
    viewerUserId = await principal(
      "People Viewer",
      `gp-viewer-${ns}@example.com`,
      OrganizationUserRole.MEMBER,
      TeamUserRole.MEMBER,
      viewerRole.id,
    );
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["customRole", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { slug: `--gp-${ns}` }],
      [
        "user",
        {
          email: {
            in: [
              `gp-admin-${ns}@example.com`,
              `gp-member-${ns}@example.com`,
              `gp-viewer-${ns}@example.com`,
            ],
          },
        },
      ],
    ]);
    await resetApp();
  });

  function callerFor(userId: string) {
    const ctx = createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" } as never,
    });
    return appRouter.createCaller(ctx);
  }

  describe("given a caller without governance view", () => {
    /** @scenario "Reading the list requires the governance view grant" */
    it("refuses the list and the suggestions to an org MEMBER", async () => {
      const caller = callerFor(memberUserId);
      await expect(
        caller.governancePeople.list({ organizationId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.governancePeople.suggestions({ organizationId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given a caller with only governance view", () => {
    it("serves the list and the suggestions", async () => {
      const caller = callerFor(viewerUserId);
      await expect(
        caller.governancePeople.list({ organizationId }),
      ).resolves.toEqual([]);
      await expect(
        caller.governancePeople.suggestions({ organizationId }),
      ).resolves.toEqual([]);
    });

    /** @scenario "Running the engine requires the governance manage grant" */
    it("refuses to run the match pass", async () => {
      const caller = callerFor(viewerUserId);
      await expect(
        caller.governancePeople.runMatch({ organizationId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario "Confirming requires the governance manage grant" */
    it("refuses to confirm a suggestion", async () => {
      const caller = callerFor(viewerUserId);
      await expect(
        caller.governancePeople.confirmSuggestion({
          organizationId,
          suggestionId: "sugg_nonexistent",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given an org ADMIN", () => {
    /** @scenario "The match button runs the proven pass and the suggestion pass" */
    it("runs both passes and answers with the counts", async () => {
      const caller = callerFor(adminUserId);
      await expect(
        caller.governancePeople.runMatch({ organizationId }),
      ).resolves.toEqual({
        linked: 0,
        suspended: 0,
        unproven: 0,
        suggestionsWritten: 0,
      });
    });

    it("reaches the service on confirm, where a vanished suggestion is its own refusal", async () => {
      const caller = callerFor(adminUserId);
      // Past the grant, the engine speaks: this suggestion does not exist.
      // The refusal carrying the engine's message rather than FORBIDDEN is
      // what proves the permission gate opened.
      await expect(
        caller.governancePeople.confirmSuggestion({
          organizationId,
          suggestionId: "sugg_nonexistent",
        }),
      ).rejects.toThrow(/suggestion/i);
    });
  });
});
