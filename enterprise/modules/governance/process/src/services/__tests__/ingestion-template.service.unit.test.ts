import {
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
  type IngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { MemoryIngestionTemplateRepository } from "../../repositories/memory/memory.ingestion-template.repository.ts";
import { IngestionTemplateService } from "../ingestion-template.service.ts";

function template(overrides: Partial<IngestionTemplate> = {}): IngestionTemplate {
  return {
    id: "template-1",
    slug: "custom_template_abc123",
    sourceType: "custom_source",
    displayName: "Custom template",
    description: null,
    iconAsset: null,
    credentialSchema: null,
    ottlRules: 'set(attributes["x"], "y")',
    platformPublished: false,
    enabled: true,
    organizationId: "organization-1",
    ...overrides,
  };
}

function seeded(initial: IngestionTemplate[] = []) {
  const store = MemoryGovernanceStore.create();
  store.ingestionTemplates.push(...initial);
  const repository = MemoryIngestionTemplateRepository.create(store);
  return {
    store,
    repository,
    createWithAudit: vi.spyOn(repository, "createWithAudit"),
    syncPlatformCatalog: vi.spyOn(repository, "syncPlatformCatalog"),
  };
}

const platformTemplate = template({
  id: "platform-1",
  organizationId: null,
  platformPublished: true,
});

describe("IngestionTemplateService", () => {
  it("hides OTTL source from the user catalog", async () => {
    const rows = await IngestionTemplateService.create({
      repository: seeded([template()]).repository,
    }).listForUser({ organizationId: "organization-1" });

    expect(rows[0]?.ottlRules).toBe("");
  });

  /** @scenario "Ingestion template authoring is tenant safe and auditable" */
  it("validates source type before persistence", async () => {
    const { store, repository, createWithAudit } = seeded();
    const service = IngestionTemplateService.create({ repository });

    await expect(
      service.createOrgTemplate({
        organizationId: "organization-1",
        callerUserId: "user-1",
        sourceType: "Invalid Source!",
        displayName: "Invalid",
      }),
    ).rejects.toBeInstanceOf(InvalidSourceTypeError);
    expect(createWithAudit).not.toHaveBeenCalled();
    expect(store.ingestionTemplates).toHaveLength(0);
  });

  it("generates a stable slug and defaults audit attribution", async () => {
    const { repository, createWithAudit } = seeded();
    const created = await IngestionTemplateService.create({
      repository,
      newSlugSuffix: () => "abc123",
    }).createOrgTemplate({
      organizationId: "organization-1",
      callerUserId: "user-1",
      sourceType: "custom_source",
      displayName: "Custom Template",
    });

    expect(created.slug).toBe("custom_template_abc123");
    expect(createWithAudit).toHaveBeenCalledWith(expect.objectContaining({ surface: "trpc" }));
  });

  /** @scenario "Ingestion template authoring is tenant safe and auditable" */
  it("refuses platform mutation without exposing another organization", async () => {
    const { repository } = seeded([
      platformTemplate,
      template({ id: "other-organization-template", organizationId: "organization-2" }),
    ]);
    const service = IngestionTemplateService.create({ repository });

    await expect(
      service.updateOttlRules({
        id: "platform-1",
        organizationId: "organization-1",
        callerUserId: "user-1",
        ottlRules: "",
      }),
    ).rejects.toBeInstanceOf(PlatformTemplateImmutableError);

    await expect(
      service.archiveOrgTemplate({
        id: "other-organization-template",
        organizationId: "organization-1",
        callerUserId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("clones platform content into a new organization template", async () => {
    const { repository, createWithAudit } = seeded([platformTemplate]);
    const cloned = await IngestionTemplateService.create({
      repository,
      newSlugSuffix: () => "abc123",
    }).cloneFromPlatform({
      sourceTemplateId: "platform-1",
      organizationId: "organization-1",
      callerUserId: "user-1",
      surface: "mcp",
    });

    expect(cloned).toMatchObject({
      organizationId: "organization-1",
      displayName: "Custom template (custom)",
      ottlRules: 'set(attributes["x"], "y")',
    });
    expect(createWithAudit).toHaveBeenCalledWith(expect.objectContaining({ surface: "mcp" }));
  });

  /** @scenario "An existing platform claude-cowork template is archived by the seeder" */
  it("syncs the platform catalog with claude_cowork among the retired slugs and no new seeds", async () => {
    const { repository, syncPlatformCatalog } = seeded();
    await IngestionTemplateService.create({ repository }).syncPlatformCatalog();

    expect(syncPlatformCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        templates: [],
        retiredSlugs: expect.arrayContaining(["claude_cowork"]),
      }),
    );
  });

  describe("when a retired platform copy is still stored and the catalog is synchronised twice", () => {
    /** @scenario "The platform ingestion template catalog reconciles idempotently" */
    it("archives and disables the retired copy and creates no duplicate on the repeat", async () => {
      const retired = template({
        id: "platform-retired",
        slug: "claude_cowork",
        organizationId: null,
        platformPublished: true,
        enabled: true,
      });
      const { store, repository } = seeded([retired]);
      const service = IngestionTemplateService.create({ repository });

      const first = await service.syncPlatformCatalog();
      const countAfterFirst = store.ingestionTemplates.length;
      const second = await service.syncPlatformCatalog();

      expect(first.archived).toBe(1);
      expect(store.ingestionTemplates.find((row) => row.id === retired.id)?.enabled).toBe(false);
      expect(second.archived).toBe(0);
      expect(second.created).toBe(0);
      expect(store.ingestionTemplates).toHaveLength(countAfterFirst);
    });
  });
});
