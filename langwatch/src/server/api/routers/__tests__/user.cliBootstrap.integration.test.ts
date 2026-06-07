/**
 * @vitest-environment node
 *
 * Integration coverage for tRPC `user.cliBootstrap` — powers the
 * login-completion ceremony in typescript-sdk
 * (formatLoginCeremony({ tools, providers, budget })).
 *
 * Wire shape (every field always populated, empty-state safe):
 *   {
 *     tools: Array<{ slug, displayName }>;
 *     providers: Array<{ name, displayName, configured }>;
 *     budget: { monthlyLimitUsd: number | null, monthlyUsedUsd: number, period: string };
 *   }
 *
 * Scope: contract-level scenarios that exercise the org-membership
 * guard, the empty-state graceful-degrade, AND the catalog-sourcing
 * contract — tools + providers come ONLY from the org's published AI
 * Tools catalog tiles, never from env-fed project providers. Budget
 * data depends on ClickHouse + a personal VK + GatewayBudget rows; the
 * non-empty budget path is exercised by the existing personalBudget
 * integration tests. This test locks the cliBootstrap-specific
 * empty-state + catalog-sourcing contract the CLI ceremony relies on.
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

import { AiToolEntryService } from "@ee/governance/services/aiToolEntry.service";

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
    await prisma.aiToolEntry.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
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

  describe("when the org has no catalog and the caller has no workspace", () => {
    it("returns empty tools + providers + null monthlyLimitUsd — graceful empty state", async () => {
      const result = await caller.user.cliBootstrap({
        organizationId: ORG_ID,
      });
      expect(result.tools).toEqual([]);
      expect(result.providers).toEqual([]);
      expect(result.budget).toEqual({
        monthlyLimitUsd: null,
        monthlyUsedUsd: 0,
        period: "MONTHLY",
      });
    });
  });

  describe("when the org has published catalog tiles", () => {
    it("sources tools + providers from the catalog, not env-fed project providers", async () => {
      const service = AiToolEntryService.create(prisma);
      // A coding-assistant tile → an `langwatch <slug>` AI tool.
      await service.create({
        organizationId: ORG_ID,
        departmentIds: [],
        type: "coding_assistant",
        displayName: "Claude Code",
        config: { assistantKind: "claude_code", setupCommand: "claude" },
        actorUserId: USER_ID,
      });
      // A model-provider tile → a provider the member can mint a VK for.
      // Deliberately NOT openai: even if the test instance has OPENAI_API_KEY
      // in env (which the old project-sourced path surfaced), the catalog
      // never published it, so it must not appear.
      await service.create({
        organizationId: ORG_ID,
        departmentIds: [],
        type: "model_provider",
        displayName: "Anthropic",
        config: { providerKey: "anthropic" },
        actorUserId: USER_ID,
      });

      const result = await caller.user.cliBootstrap({
        organizationId: ORG_ID,
      });

      expect(result.tools).toEqual([
        { slug: "claude", displayName: "Claude Code" },
      ]);
      expect(result.providers).toEqual([
        { name: "anthropic", displayName: "Anthropic", configured: false },
      ]);
      // The env-fed openai provider the legacy path leaked is absent.
      expect(
        result.providers.find((p) => p.name === "openai"),
      ).toBeUndefined();
    });
  });
});
