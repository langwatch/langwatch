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
 *   - sdks/typescript/src/cli/utils/governance/__tests__ (CLI consumer
 *     side renders the wire shape returned here)
 */

import { AiToolEntryService } from "@ee/governance/services/aiToolEntry.service";
import { PLATFORM_TOOL_POLICY_DEFAULTS } from "@ee/governance/services/platformToolPolicy.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../../db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

describe("user.cliBootstrap integration", () => {
  const ns = `cliboot-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const OTHER_ORG_ID = `org-other-${ns}`;
  const USER_ID = `usr-${ns}`;

  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await startTestContainers();

    // The routes and workers under test take their ClickHouse repositories
    // from the App rather than resolving a client, so the fixture has to
    // provide one or they fail with "App not initialized".
    installClickHouseTestApp({
      resolveClient: async () => getTestClickHouseClient(),
    });
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: "CliBoot Org", slug: `cliboot-${ns}` },
        {
          id: OTHER_ORG_ID,
          name: "CliBoot Other Org",
          slug: `cliboot-other-${ns}`,
        },
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
    await clearClickHouseTestApp();
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
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when the org has no catalog and the caller has no workspace", () => {
    it("returns empty tools + providers + null monthlyLimitUsd — graceful empty state", async () => {
      const result = await caller.user.cliBootstrap({
        organizationId: ORG_ID,
      });
      expect(result.tools).toEqual([]);
      expect(result.providers).toEqual([]);
      expect(result.gatewayProviders).toEqual([]);
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
      expect(result.providers.find((p) => p.name === "openai")).toBeUndefined();
      // gatewayProviders reflects CONFIGURED credentials, not catalog tiles:
      // the anthropic tile is published but no credential is configured, so
      // the gateway has nothing to route through.
      expect(result.gatewayProviders).toEqual([]);
    });
  });

  describe("when the org has published a pi tile with a stricter policy", () => {
    /**
     * The whole path, not the constants: a `pi` tile written to Postgres,
     * read back through `resolveVisibleTilesForUser` →
     * `ASSISTANT_KIND_TO_TOOL_SLUG` → `resolveToolPolicyOverrides`, merged
     * over `PLATFORM_TOOL_POLICY_DEFAULTS`, and served in the same
     * `toolPolicies` map the CLI caches at login and gates
     * `langwatch pi` on.
     *
     * A kind missing from `ASSISTANT_KIND_TO_TOOL_SLUG` is skipped
     * silently — no error, no entry — and the slug keeps the shipped
     * default. That is the failure this asserts against, so the stricter
     * policy is deliberately the inverse of the default on the one path
     * the tile can move: a half-registered pi returns the default and this
     * goes red.
     */
    /** @scenario "A pi policy set in the tile is the one the launcher applies" */
    it("serves that policy in toolPolicies rather than the shipped default", async () => {
      // pi ships with the gateway path already off and direct ingestion on,
      // and `resolveToolPolicyOverrides` forces allowVk false whatever the
      // tile says (pi ignores the base-URL env, ADR-132 §7). So allowVk
      // cannot distinguish tile from default here — allowOtelDirect is the
      // one axis that can, and the tile sets it to the inverse below.
      // Asserted rather than assumed: if the default ever changes to match,
      // the test below would pass for the wrong reason.
      expect(PLATFORM_TOOL_POLICY_DEFAULTS.pi).toEqual({
        allowVk: false,
        allowOtelDirect: true,
      });

      await AiToolEntryService.create(prisma).create({
        organizationId: ORG_ID,
        departmentIds: [],
        type: "coding_assistant",
        displayName: "pi",
        config: {
          assistantKind: "pi",
          setupCommand: "langwatch pi",
          allowVk: false,
          allowOtelDirect: false,
        },
        actorUserId: USER_ID,
      });

      const result = await caller.user.cliBootstrap({
        organizationId: ORG_ID,
      });

      expect(result.toolPolicies.pi).toEqual({
        allowVk: false,
        allowOtelDirect: false,
      });
      expect(result.toolPolicies.pi).not.toEqual(
        PLATFORM_TOOL_POLICY_DEFAULTS.pi,
      );
      // A slug the org published no tile for still carries its default, so
      // the map above is the tile's policy merged over the defaults rather
      // than the whole map having been replaced.
      expect(result.toolPolicies.gemini).toEqual(
        PLATFORM_TOOL_POLICY_DEFAULTS.gemini,
      );
    });
  });
});
