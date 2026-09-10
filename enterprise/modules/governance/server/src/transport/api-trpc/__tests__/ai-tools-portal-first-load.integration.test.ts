/**
 * @vitest-environment node
 * A member's FIRST portal load, through the real `aiTools.list` procedure.
 * Spec: specs/ai-governance/personal-portal/default-catalog.feature
 */
import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import {
  AI_TOOL_STARTER_TILES,
  type GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { TestGovernanceService } from "../../../app/__tests__/support/test-governance-service.ts";
import { AiToolProviderCatalogPort, AiToolSlugPort } from "../../../ports/ai-tool-catalog.port.ts";
import { PrismaAiToolCatalogRepository } from "../../../repositories/prisma/prisma.ai-tool-catalog.repository.ts";
import { DefaultGovernanceAiToolCatalogService } from "../../../services/ai-tool-catalog.service.ts";
import { AiToolsTrpcApi } from "../ai-tools.api.ts";

/** This suite writes the rows it then reads; no project owns any of them. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class SlugFromName extends AiToolSlugPort {
  generate(displayName: string): string {
    return displayName
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-");
  }
}

/** The portal read never reaches the provider catalog. */
class NoProviders extends AiToolProviderCatalogPort {
  list(): Array<{ providerKey: string; displayName: string; type: string }> {
    return [];
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `portal-first-${nanoid(8)}`;
const createdOrgIds: string[] = [];

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await prisma.aiToolEntry.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
  }
});

describe.skipIf(!databaseUrl)("given a brand-new organization whose catalog has no rows", () => {
  describe("when a member opens their portal for the first time", () => {
    /** @scenario A member's first portal load of a zero-row organization returns the provisioned catalog */
    it("returns the standard catalog, all enabled, instead of an empty list", async () => {
      const organization = await prisma.organization.create({
        data: { name: `Portal ${ns}`, slug: `--pf-${ns}` },
      });
      createdOrgIds.push(organization.id);
      const member = await prisma.user.create({
        data: { name: "Member", email: `member-${ns}@example.com` },
      });
      await prisma.organizationUser.create({
        data: { userId: member.id, organizationId: organization.id, role: "MEMBER" },
      });

      // The zero-row precondition the provisioning guard reads; without it a
      // pass here would prove nothing about a fresh organization.
      expect(await prisma.aiToolEntry.count({ where: { organizationId: organization.id } })).toBe(
        0,
      );

      const tiles = await caller(member.id).list({ organizationId: organization.id });

      expect(tiles).toHaveLength(AI_TOOL_STARTER_TILES.length);
      expect(tiles.every((tile) => tile.enabled)).toBe(true);
      expect(tiles.map((tile) => tile.slug).sort()).toEqual(
        AI_TOOL_STARTER_TILES.map((tile) => tile.slug).sort(),
      );
    });
  });
});

/** The `aiTools` surface as a process mounts it, over the real catalog. */
function caller(userId: string) {
  const catalog = DefaultGovernanceAiToolCatalogService.create({
    repository: PrismaAiToolCatalogRepository.create(prisma),
    slugs: new SlugFromName(),
    providers: new NoProviders(),
  });

  class PortalGovernance extends TestGovernanceService {
    override aiToolEnsureDefaultCatalog: GovernanceApi["aiToolEnsureDefaultCatalog"] = (
      input,
    ) => catalog.ensureDefaultCatalog(input);

    override aiToolListForUser: GovernanceApi["aiToolListForUser"] = (input) =>
      catalog.listForUser(input);
  }

  type PortalContext = {
    app: { governance: GovernanceApi };
    actor(): { id: string };
  };

  const trpc = initTRPC.context<PortalContext>().create();
  const router = AiToolsTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
    validateOutput: true,
  });

  return router.createCaller({
    app: { governance: new PortalGovernance() },
    actor: () => ({ id: userId }),
  });
}
