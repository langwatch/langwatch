import {
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
  type GovernanceCallSurface,
  type IngestionTemplate,
  type PlatformIngestionTemplateSeed,
  type PlatformIngestionTemplateSyncResult,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import {
  IngestionTemplateRepository,
  type IngestionTemplateMutationResult,
  type NewIngestionTemplate,
} from "../ingestion-template.port";
import { IngestionTemplateService } from "../../services/ingestion-template.service";

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

class MemoryIngestionTemplateRepository extends IngestionTemplateRepository {
  readonly createWithAudit = vi.fn(
    async (input: {
      template: NewIngestionTemplate;
      callerUserId: string;
      surface: GovernanceCallSurface;
    }) => template({ ...input.template }),
  );
  mutationResult: IngestionTemplateMutationResult = {
    status: "updated",
    template: template(),
  };

  async listUserVisible(): Promise<IngestionTemplate[]> {
    return [template()];
  }

  async listAdminVisible(): Promise<IngestionTemplate[]> {
    return [template()];
  }

  async tryFindVisible(): Promise<IngestionTemplate | null> {
    return template();
  }

  async tryFindPlatform(): Promise<IngestionTemplate | null> {
    return template({ organizationId: null, platformPublished: true });
  }

  async updateOttlRulesWithAudit(): Promise<IngestionTemplateMutationResult> {
    return this.mutationResult;
  }

  async archiveWithAudit(): Promise<IngestionTemplateMutationResult> {
    return this.mutationResult;
  }

  async syncPlatformCatalog(input: {
    templates: readonly PlatformIngestionTemplateSeed[];
    retiredSlugs: readonly string[];
  }): Promise<PlatformIngestionTemplateSyncResult> {
    return {
      created: input.templates.length,
      updated: 0,
      archived: input.retiredSlugs.length,
    };
  }
}

describe("IngestionTemplateService", () => {
  it("hides OTTL source from the user catalog", async () => {
    const rows = await IngestionTemplateService.create({
      repository: new MemoryIngestionTemplateRepository(),
    }).listForUser({ organizationId: "organization-1" });

    expect(rows[0]?.ottlRules).toBe("");
  });

  /** @scenario "Ingestion template authoring is tenant safe and auditable" */
  it("validates source type before persistence", async () => {
    const repository = new MemoryIngestionTemplateRepository();
    const service = IngestionTemplateService.create({ repository });

    await expect(
      service.createOrgTemplate({
        organizationId: "organization-1",
        callerUserId: "user-1",
        sourceType: "Invalid Source!",
        displayName: "Invalid",
      }),
    ).rejects.toBeInstanceOf(InvalidSourceTypeError);
    expect(repository.createWithAudit).not.toHaveBeenCalled();
  });

  it("generates a stable slug and defaults audit attribution", async () => {
    const repository = new MemoryIngestionTemplateRepository();
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
    expect(repository.createWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "trpc" }),
    );
  });

  /** @scenario "Ingestion template authoring is tenant safe and auditable" */
  it("refuses platform mutation without exposing another organization", async () => {
    const repository = new MemoryIngestionTemplateRepository();
    const service = IngestionTemplateService.create({ repository });
    repository.mutationResult = { status: "platform" };

    await expect(
      service.updateOttlRules({
        id: "platform-1",
        organizationId: "organization-1",
        callerUserId: "user-1",
        ottlRules: "",
      }),
    ).rejects.toBeInstanceOf(PlatformTemplateImmutableError);

    repository.mutationResult = { status: "not_found" };
    await expect(
      service.archiveOrgTemplate({
        id: "other-organization-template",
        organizationId: "organization-1",
        callerUserId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("clones platform content into a new organization template", async () => {
    const repository = new MemoryIngestionTemplateRepository();
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
    expect(repository.createWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "mcp" }),
    );
  });
});
