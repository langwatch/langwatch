// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The department assignment pickers list the organisation's projects, and
 * they open on `governance:view`. That grant is not the admin role's alone: a
 * custom role bound at organisation scope carries it to a plain member (the
 * delegated governance viewer). An aggregate reads other people's personal
 * projects (ADR-144 decision 5), so it is listed to organisation admins only,
 * and the pickers must leave it out for everyone else.
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
import { realOrganizationService } from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AGGREGATE_PROJECT_KIND } from "~/server/app-layer/projects/project-kinds";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { seedCustomRole, seedRoleBinding } from "~/test-utils/authz-seeds";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

describe("departments router, aggregate project visibility", () => {
  const ns = `dept-agg-${nanoid(8)}`;
  const APPLICATION_PROJECT_ID = `proj-app-${ns}`;
  const AGGREGATE_PROJECT_ID = `proj-agg-${ns}`;

  let organizationId: string;
  let adminUserId: string;
  let viewerUserId: string;

  beforeAll(async () => {
    await resetApp();
    // The router asks the App for the caller's organisation role.
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
      planProvider: PlanProviderService.create({
        getActivePlan: async () => enterprisePlan,
      }),
    });

    const organization = await prisma.organization.create({
      data: { name: `Dept Agg Org ${ns}`, slug: `--da-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: `Dept Agg Team ${ns}`,
        slug: `--da-team-${ns}`,
        organizationId,
      },
    });

    for (const [id, kind] of [
      [APPLICATION_PROJECT_ID, "application"],
      [AGGREGATE_PROJECT_ID, AGGREGATE_PROJECT_KIND],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId: team.id,
          kind,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
        },
      });
    }

    const principal = async ({
      email,
      orgRole,
      customRoleId,
    }: {
      email: string;
      orgRole: OrganizationUserRole;
      customRoleId?: string;
    }) => {
      const user = await prisma.user.create({ data: { name: email, email } });
      await prisma.organizationUser.create({
        data: { userId: user.id, organizationId, role: orgRole },
      });
      await seedRoleBinding(prisma, {
        id: `dept-agg-${user.id}`,
        organizationId,
        userId: user.id,
        role: customRoleId
          ? TeamUserRole.CUSTOM
          : orgRole === OrganizationUserRole.ADMIN
            ? TeamUserRole.ADMIN
            : TeamUserRole.MEMBER,
        customRoleId: customRoleId ?? null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      });
      return user.id;
    };

    adminUserId = await principal({
      email: `da-admin-${ns}@example.com`,
      orgRole: OrganizationUserRole.ADMIN,
    });

    const viewerRole = await seedCustomRole(prisma, {
      organizationId,
      name: `Governance viewer ${ns}`,
      permissions: ["organization:view", "governance:view"],
    });
    viewerUserId = await principal({
      email: `da-viewer-${ns}@example.com`,
      orgRole: OrganizationUserRole.MEMBER,
      customRoleId: viewerRole.id,
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["grant", { organizationId }],
      ["role", { organizationId }],
      ["customRole", { organizationId }],
      ["project", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { slug: `--da-${ns}` }],
      [
        "user",
        {
          email: {
            in: [`da-admin-${ns}@example.com`, `da-viewer-${ns}@example.com`],
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

  describe("given a member holding governance view through a custom role", () => {
    describe("when they read the department assignments", () => {
      it("lists the ordinary project and leaves the aggregate out", async () => {
        const assignments = await callerFor(
          viewerUserId,
        ).departments.assignments({ organizationId });

        const projectIds = assignments.projects.map((p) => p.id);
        expect(projectIds).toContain(APPLICATION_PROJECT_ID);
        expect(projectIds).not.toContain(AGGREGATE_PROJECT_ID);
      });
    });
  });

  describe("given an organisation admin", () => {
    describe("when they read the department assignments", () => {
      it("lists the aggregate beside the ordinary project", async () => {
        const assignments = await callerFor(
          adminUserId,
        ).departments.assignments({ organizationId });

        const projectIds = assignments.projects.map((p) => p.id);
        expect(projectIds).toEqual(
          expect.arrayContaining([
            APPLICATION_PROJECT_ID,
            AGGREGATE_PROJECT_ID,
          ]),
        );
      });
    });
  });
});
