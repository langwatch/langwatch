/**
 * @vitest-environment node
 *
 * Zero-touch default catalog provisioning: every org gets the standard
 * AI tool set automatically, so the /me portal never opens on the
 * "Add your first tools" empty state for a fresh signup. The guard is
 * strictly conservative - any existing AiToolEntry row (enabled,
 * disabled, or archived) means an admin owns the catalog and
 * provisioning keeps its hands off.
 *
 * Hits real Postgres through PrismaAiToolCatalogRepository (no mocks).
 *
 * Spec: specs/ai-governance/personal-portal/default-catalog.feature
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

import { PrismaAiToolCatalogRepository } from "../prisma.ai-tool-catalog.repository";

/**
 * The tenancy guard names a project on every query. This suite writes the
 * rows it then reads, so it composes the client without a guard rather than
 * teaching one about rows that do not exist yet.
 */
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

const ns = `dfltcat-${nanoid(8)}`;
const createdOrgIds: string[] = [];

async function createOrg(label: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `Default Catalog ${label} ${ns}`,
      slug: `--dc-${label}-${ns}`,
    },
  });
  createdOrgIds.push(org.id);
  return org.id;
}

const repository = PrismaAiToolCatalogRepository.create(prisma);

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await prisma.aiToolEntry.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
  }
});

describe.skipIf(!databaseUrl)("PrismaAiToolCatalogRepository.ensureDefaultCatalog", () => {
  /** @scenario "A fresh organization gets the full standard catalog with no admin action" */
  it("provisions all standard tiles onto a zero-row org", async () => {
    const organizationId = await createOrg("fresh");

    const result = await repository.ensureDefaultCatalog({
      organizationId,
      tiles: AI_TOOL_STARTER_TILES,
    });
    expect(result).toEqual({
      hasSeeded: true,
      created: AI_TOOL_STARTER_TILES.length,
    });

    const rows = await prisma.aiToolEntry.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
    expect(rows).toHaveLength(AI_TOOL_STARTER_TILES.length);
    rows.forEach((row, index) => {
      const tile = AI_TOOL_STARTER_TILES[index]!;
      expect(row.slug).toBe(tile.slug);
      expect(row.displayName).toBe(tile.displayName);
      expect(row.type).toBe(tile.type);
      expect(row.order).toBe(index);
      expect(row.enabled).toBe(true);
      expect(row.archivedAt).toBeNull();
      expect(row.scope).toBe("organization");
      expect(row.scopeId).toBe(organizationId);
      expect(row.createdById).toBeNull();
      expect(row.updatedById).toBeNull();
    });
  });

  /** @scenario "Default catalog provisioning is idempotent across repeated calls" */
  it("does nothing on an org that already has the catalog", async () => {
    const organizationId = await createOrg("idem");
    await repository.ensureDefaultCatalog({ organizationId, tiles: AI_TOOL_STARTER_TILES });

    const second = await repository.ensureDefaultCatalog({
      organizationId,
      tiles: AI_TOOL_STARTER_TILES,
    });
    expect(second).toEqual({ hasSeeded: false, created: 0 });
    expect(await prisma.aiToolEntry.count({ where: { organizationId } })).toBe(
      AI_TOOL_STARTER_TILES.length,
    );
  });

  /** @scenario "An organization whose admin archived or disabled every entry is not re-seeded" */
  it("respects a curated-empty catalog (archived and disabled rows both count)", async () => {
    const organizationId = await createOrg("curated");
    await prisma.aiToolEntry.createMany({
      data: [
        {
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "coding_assistant",
          displayName: "Archived Claude",
          slug: `archived-claude-${ns}`,
          config: {
            assistantKind: "claude_code",
            setupCommand: "langwatch claude",
          },
          enabled: false,
          archivedAt: new Date(),
        },
        {
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "model_provider",
          displayName: "Disabled OpenAI",
          slug: `disabled-openai-${ns}`,
          config: { providerKey: "openai" },
          enabled: false,
        },
      ],
    });

    const result = await repository.ensureDefaultCatalog({
      organizationId,
      tiles: AI_TOOL_STARTER_TILES,
    });
    expect(result).toEqual({ hasSeeded: false, created: 0 });

    const rows = await prisma.aiToolEntry.findMany({ where: { organizationId } });
    expect(rows.map((r) => r.slug).sort()).toEqual(
      [`archived-claude-${ns}`, `disabled-openai-${ns}`].sort(),
    );
  });

  /** @scenario "Concurrent provisioning attempts create exactly one catalog" */
  it("serialises concurrent provisioners via the per-org advisory lock", async () => {
    const organizationId = await createOrg("race");

    const [a, b] = await Promise.all([
      repository.ensureDefaultCatalog({ organizationId, tiles: AI_TOOL_STARTER_TILES }),
      repository.ensureDefaultCatalog({ organizationId, tiles: AI_TOOL_STARTER_TILES }),
    ]);

    expect([a, b].filter((r) => r.hasSeeded)).toHaveLength(1);

    const rows = await prisma.aiToolEntry.findMany({
      where: { organizationId },
      select: { slug: true },
    });
    expect(rows).toHaveLength(AI_TOOL_STARTER_TILES.length);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(AI_TOOL_STARTER_TILES.length);
  });
});
