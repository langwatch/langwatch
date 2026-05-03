/**
 * @vitest-environment node
 *
 * Integration coverage for tRPC `user.personalBudget` — powers the
 * /me dashboard's BudgetExceededBanner. Same wire shape as the CLI
 * 402 payload (see docs/ai-gateway/governance/cli-reference.mdx
 * "Budget pre-check"), so banner + CLI box can never disagree.
 *
 * The hard_block / 402 path is exercised end-to-end by
 * gatewayBudgetSync.reactor.integration.test.ts which uses the same
 * `GatewayBudgetService.check()` code path. This file focuses on:
 *
 *   1. Org-membership guard (rejected when caller is not in the org).
 *   2. {status: "ok"} graceful fallback when no personal workspace.
 *
 * The "no personal VK" graceful-fallback case lives upstream — the
 * tRPC procedure short-circuits BEFORE the VK lookup when the
 * workspace itself is missing, so the no-workspace describe below
 * already exercises the same branch from the user's perspective.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

describe("user.personalBudget integration", () => {
  const ns = `pbudget-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const OTHER_ORG_ID = `org-other-${ns}`;
  const USER_ID = `usr-${ns}`;

  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: "PB Org", slug: `pb-${ns}` },
        { id: OTHER_ORG_ID, name: "PB Other Org", slug: `pb-other-${ns}` },
      ],
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `${ns}@example.com`,
        name: "PB Tester",
      },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });
    // RoleBindings are required by hasOrganizationPermission — without
    // one (or a TeamUser legacy fallback), MEMBER-role users fail the
    // organization:view permission check.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });

    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: {
            id: USER_ID,
            email: `${ns}@example.com`,
            name: "PB Tester",
          },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as any,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    const orgIds = [ORG_ID, OTHER_ORG_ID];
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: { in: orgIds } } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.virtualKey.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: orgIds } } },
    });
    await prisma.team.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 60_000);

  describe("when the caller is not a member of the organization", () => {
    it("rejects with UNAUTHORIZED via the checkOrganizationPermission middleware", async () => {
      await expect(
        caller.user.personalBudget({ organizationId: OTHER_ORG_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("when the caller has no personal workspace yet", () => {
    it("returns {status: 'ok'} — graceful fallback, banner does not render", async () => {
      const result = await caller.user.personalBudget({
        organizationId: ORG_ID,
      });
      expect(result).toEqual({ status: "ok" });
    });
  });
});
