/**
 * @vitest-environment node
 *
 * Integration coverage for tRPC `user.cliBootstrap` — powers the
 * Storyboard Screen 4 login-completion ceremony in typescript-sdk
 * (formatLoginCeremony({ providers, budget })).
 *
 * Wire shape (every field always populated, empty-state safe):
 *   {
 *     providers: Array<{ name, displayName, models[] }>;
 *     budget: { monthlyLimitUsd: number | null, monthlyUsedUsd: number, period: string };
 *   }
 *
 * Scope: contract-level scenarios that exercise the org-membership
 * guard + the empty-state graceful-degrade. Provider listing depends
 * on env-var configuration (registry's `enabledSince + apiKey` check
 * — present iff the LangWatch instance has the upstream key set);
 * budget data depends on ClickHouse + a personal VK + GatewayBudget
 * rows. The non-empty paths are exercised by the existing
 * personalBudget + ModelProviderService integration tests; this test
 * locks the cliBootstrap-specific empty-state contract that
 * @ai_gateway_andre's CLI ceremony relies on.
 *
 * Pairs with:
 *   - user.personalBudget.integration.test.ts (budget service shape)
 *   - typescript-sdk/src/cli/utils/governance/__tests__ (CLI consumer
 *     side renders the wire shape returned here)
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

describe("user.cliBootstrap integration", () => {
  const ns = `cliboot-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const OTHER_ORG_ID = `org-other-${ns}`;
  const USER_ID = `usr-${ns}`;

  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: "CliBoot Org", slug: `cliboot-${ns}` },
        { id: OTHER_ORG_ID, name: "CliBoot Other Org", slug: `cliboot-other-${ns}` },
      ],
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `${ns}@example.com`,
        name: "CliBoot Tester",
      },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });
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
            name: "CliBoot Tester",
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
    it("rejects via the checkOrganizationPermission middleware", async () => {
      await expect(
        caller.user.cliBootstrap({ organizationId: OTHER_ORG_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("when the caller has no personal workspace yet", () => {
    it("returns empty providers + null monthlyLimitUsd — graceful empty state", async () => {
      const result = await caller.user.cliBootstrap({
        organizationId: ORG_ID,
      });
      expect(result.providers).toEqual([]);
      expect(result.budget).toEqual({
        monthlyLimitUsd: null,
        monthlyUsedUsd: 0,
        period: "MONTHLY",
      });
    });
  });
});
