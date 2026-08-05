// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
 * Hits real Postgres through the real AiToolEntryService and the real
 * platform-template seeder (no mocks). Requires: PostgreSQL (Prisma).
 *
 * Spec: specs/ai-governance/personal-portal/default-catalog.feature
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import { AiToolEntryService, STARTER_PACK_TILES } from "../aiToolEntry.service";
import { seedPlatformIngestionTemplates } from "../platformIngestionTemplates.seeds";

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

const service = AiToolEntryService.create(prisma);

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

describe("AiToolEntryService.ensureDefaultCatalog", () => {
  /** @scenario A fresh organization gets the full standard catalog with no admin action */
  it("provisions all standard tiles onto a zero-row org", async () => {
    const organizationId = await createOrg("fresh");

    const result = await service.ensureDefaultCatalog({ organizationId });
    expect(result).toEqual({
      hasSeeded: true,
      created: STARTER_PACK_TILES.length,
    });

    const rows = await prisma.aiToolEntry.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
    expect(rows).toHaveLength(STARTER_PACK_TILES.length);
    rows.forEach((row, index) => {
      const tile = STARTER_PACK_TILES[index]!;
      // Same shape an admin starter-pack import creates: verbatim slug,
      // org-wide scope, enabled, config and icon straight from the pack.
      expect(row.slug).toBe(tile.slug);
      expect(row.displayName).toBe(tile.displayName);
      expect(row.type).toBe(tile.type);
      expect(row.iconAsset).toBe(tile.iconAsset);
      expect(row.config).toEqual(tile.config);
      expect(row.order).toBe(index);
      expect(row.enabled).toBe(true);
      expect(row.archivedAt).toBeNull();
      expect(row.scope).toBe("organization");
      expect(row.scopeId).toBe(organizationId);
      // Platform-provisioned, not a user action.
      expect(row.createdById).toBeNull();
      expect(row.updatedById).toBeNull();
    });
  });

  /** @scenario Default catalog provisioning is idempotent across repeated calls */
  it("does nothing on an org that already has the catalog", async () => {
    const organizationId = await createOrg("idem");
    await service.ensureDefaultCatalog({ organizationId });

    const second = await service.ensureDefaultCatalog({ organizationId });
    expect(second).toEqual({ hasSeeded: false, created: 0 });
    expect(await prisma.aiToolEntry.count({ where: { organizationId } })).toBe(
      STARTER_PACK_TILES.length,
    );
  });

  /** @scenario An organization whose admin archived or disabled every entry is not re-seeded */
  it("respects a curated-empty catalog (archived and disabled rows both count)", async () => {
    const organizationId = await createOrg("curated");
    // The admin's leftovers: one archived, one disabled. The portal list
    // shows neither, but the org has HAD a catalog, so provisioning must
    // not resurrect anything.
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

    const result = await service.ensureDefaultCatalog({ organizationId });
    expect(result).toEqual({ hasSeeded: false, created: 0 });

    const rows = await prisma.aiToolEntry.findMany({
      where: { organizationId },
    });
    expect(rows.map((r) => r.slug).sort()).toEqual(
      [`archived-claude-${ns}`, `disabled-openai-${ns}`].sort(),
    );
  });

  /** @scenario Concurrent provisioning attempts create exactly one catalog */
  it("serialises concurrent provisioners via the per-org advisory lock", async () => {
    const organizationId = await createOrg("race");

    const [a, b] = await Promise.all([
      service.ensureDefaultCatalog({ organizationId }),
      service.ensureDefaultCatalog({ organizationId }),
    ]);

    // Exactly one call wins the advisory lock and inserts; the other
    // re-checks under the lock (or trips the cheap pre-check) and backs
    // off. There is no unique constraint on (organizationId, slug), so
    // this lock is the only thing standing between us and duplicates.
    expect([a, b].filter((r) => r.hasSeeded)).toHaveLength(1);

    const rows = await prisma.aiToolEntry.findMany({
      where: { organizationId },
      select: { slug: true },
    });
    expect(rows).toHaveLength(STARTER_PACK_TILES.length);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(
      STARTER_PACK_TILES.length,
    );
  });
});

describe("seedPlatformIngestionTemplates with no platform defaults", () => {
  /** @scenario An existing platform claude-cowork template is archived by the seeder */
  it("archives a pre-existing platform claude_cowork row and creates no defaults", async () => {
    // A platform row (organizationId NULL) as earlier releases seeded it.
    // The platform catalog is global, so reactivate an existing row
    // instead of duplicating one if this shared test DB already has it.
    const existing = await prisma.ingestionTemplate.findFirst({
      where: { organizationId: null, slug: "claude_cowork" },
      select: { id: true },
    });
    const row = existing
      ? await prisma.ingestionTemplate.update({
          where: { id: existing.id },
          data: { enabled: true, archivedAt: null, platformPublished: true },
        })
      : await prisma.ingestionTemplate.create({
          data: {
            organizationId: null,
            slug: "claude_cowork",
            sourceType: "claude_cowork",
            displayName: "Claude cowork",
            description: "legacy platform default",
            iconAsset: "preset:claude_cowork",
            credentialSchema: null,
            ottlRules: "",
            platformPublished: true,
            enabled: true,
          },
        });

    try {
      const result = await seedPlatformIngestionTemplates(prisma);
      // The seed input is empty: nothing is created or updated, ever.
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);

      // Final state is the contract (not the archived counter: the row is
      // global, and a concurrently lazy-seeding suite may have archived
      // it first) - after any seeder run, no active platform cowork row
      // remains.
      const after = await prisma.ingestionTemplate.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.archivedAt).not.toBeNull();
      expect(after.enabled).toBe(false);

      // Idempotent: a second run has nothing left to archive.
      const again = await seedPlatformIngestionTemplates(prisma);
      expect(again).toEqual({ created: 0, updated: 0, archived: 0 });
    } finally {
      // Leave the DB converged (archived) when the row pre-existed;
      // remove the row entirely when this test created it.
      if (!existing) {
        await prisma.ingestionTemplate.deleteMany({ where: { id: row.id } });
      }
    }
  });

  /** @scenario An existing platform claude-cowork template is archived by the seeder */
  it("archives every unarchived platform row for a retired slug, duplicates included", async () => {
    // (organizationId, slug) has no unique backing when organizationId is
    // NULL (Postgres treats NULL as not-equal-to-NULL), so duplicate
    // platform rows for the same retired slug can exist. The retirement
    // sweep must catch ALL of them in a single seeder run, not one per run.
    const makeRow = () =>
      prisma.ingestionTemplate.create({
        data: {
          organizationId: null,
          slug: "claude_cowork",
          sourceType: "claude_cowork",
          displayName: "Claude cowork",
          description: "duplicate legacy platform default",
          iconAsset: "preset:claude_cowork",
          credentialSchema: null,
          ottlRules: "",
          platformPublished: true,
          enabled: true,
        },
      });
    // Collect ids as rows are created so a failure between the two creates
    // still leaves the finally with the exact rows to delete (the in-array
    // filter stays safe when only one, or neither, was created).
    const createdIds: string[] = [];
    try {
      createdIds.push((await makeRow()).id);
      createdIds.push((await makeRow()).id);

      const result = await seedPlatformIngestionTemplates(prisma);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);

      // Final state is the contract (not the archived counter: the rows
      // are global, and a concurrently seeding suite may have archived
      // some first) - after one seeder run, NO active platform cowork
      // row remains, not even the duplicate beyond the first.
      const rows = await prisma.ingestionTemplate.findMany({
        where: { id: { in: createdIds } },
      });
      expect(rows).toHaveLength(2);
      for (const rowAfter of rows) {
        expect(rowAfter.archivedAt).not.toBeNull();
        expect(rowAfter.enabled).toBe(false);
      }
    } finally {
      await prisma.ingestionTemplate.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
  });
});
