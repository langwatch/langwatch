/**
 * @vitest-environment node
 * The admin starter-pack import against real Postgres, no mocks.
 * Spec: specs/ai-governance/personal-portal/admin-catalog-editor.feature
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { AI_TOOL_STARTER_TILES } from "@langwatch/enterprise-governance-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { PrismaAiToolCatalogRepository } from "../prisma.ai-tool-catalog.repository.ts";

/** This suite writes the rows it then reads; no project owns any of them. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `starter-${nanoid(8)}`;
const createdOrgIds: string[] = [];

async function createOrg(label: string): Promise<string> {
  const org = await prisma.organization.create({
    data: { name: `Starter ${label} ${ns}`, slug: `--sp-${label}-${ns}` },
  });
  createdOrgIds.push(org.id);

  return org.id;
}

const repository = PrismaAiToolCatalogRepository.create(prisma);

const importStarterPack = (organizationId: string) =>
  repository.seedStarterPack({
    values: { organizationId },
    tiles: AI_TOOL_STARTER_TILES,
  });

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await prisma.aiToolEntry.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  }
});

describe.skipIf(!databaseUrl)("PrismaAiToolCatalogRepository.seedStarterPack", () => {
  describe("given a catalog that already holds the starter pack", () => {
    /** @scenario "re-importing the starter pack adds only tiles the catalog never had" */
    it("creates the tile the admin removed and skips every tile still present", async () => {
      const organizationId = await createOrg("reimport");
      const first = await importStarterPack(organizationId);
      expect(first.created).toBe(AI_TOOL_STARTER_TILES.length);

      await prisma.aiToolEntry.deleteMany({ where: { organizationId, slug: "gemini" } });

      const second = await importStarterPack(organizationId);

      expect(second.created).toBe(1);
      expect(second.skipped).toBe(AI_TOOL_STARTER_TILES.length - 1);

      const rows = await prisma.aiToolEntry.findMany({ where: { organizationId } });
      expect(rows).toHaveLength(AI_TOOL_STARTER_TILES.length);
      expect(rows.filter((row) => row.slug === "gemini")).toHaveLength(1);
    });
  });

  describe("given a starter tile the admin archived", () => {
    /** @scenario "an archived starter tile is not restored or duplicated by a re-import" */
    it("leaves it archived and adds no second tile under the same name", async () => {
      const organizationId = await createOrg("archived");
      await importStarterPack(organizationId);

      const codex = await prisma.aiToolEntry.findFirstOrThrow({
        where: { organizationId, slug: "codex" },
      });
      await prisma.aiToolEntry.update({
        where: { id: codex.id },
        data: { archivedAt: new Date() },
      });

      const result = await importStarterPack(organizationId);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(AI_TOOL_STARTER_TILES.length);

      const sameName = await prisma.aiToolEntry.findMany({
        where: { organizationId, displayName: codex.displayName },
      });
      expect(sameName).toHaveLength(1);
      expect(sameName[0]!.id).toBe(codex.id);
      expect(sameName[0]!.archivedAt).not.toBeNull();
    });
  });
});
