import {
  DEFAULT_GOVERNANCE_SURFACE,
  InvalidSourceTypeError,
  PLATFORM_INGESTION_TEMPLATES,
  PlatformTemplateImmutableError,
  RETIRED_PLATFORM_TEMPLATE_SLUGS,
  TemplateNotFoundError,
  archiveIngestionTemplateInputSchema,
  cloneIngestionTemplateInputSchema,
  createIngestionTemplateInputSchema,
  ingestionTemplateSourceTypeSchema,
  updateIngestionTemplateOttlInputSchema,
  type ArchiveIngestionTemplateInput,
  type CloneIngestionTemplateInput,
  type CreateIngestionTemplateInput,
  type IngestionTemplate,
  type PlatformIngestionTemplateSyncResult,
  type UpdateIngestionTemplateOttlInput,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import type { IngestionTemplateRepository } from "../ports/ingestion-template.port";

export class IngestionTemplateService {
  private constructor(
    private readonly repository: IngestionTemplateRepository,
    private readonly newSlugSuffix: () => string,
    private readonly now: () => Date,
  ) {
  }

  static create(options: {
    repository: IngestionTemplateRepository;
    newSlugSuffix?: () => string;
    now?: () => Date;
  }): IngestionTemplateService {
    return new IngestionTemplateService(
      options.repository,
      options.newSlugSuffix ??
        (() => generate("ingestiontemplate").toString().slice(-6).toLowerCase()),
      options.now ?? (() => new Date()),
    );
  }

  async listForUser(input: { organizationId: string }): Promise<IngestionTemplate[]> {
    const templates = await this.repository.listUserVisible(input.organizationId);
    return templates.map((template) => ({ ...template, ottlRules: "" }));
  }

  listForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]> {
    return this.repository.listAdminVisible(input.organizationId);
  }

  tryFindByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null> {
    return this.repository.tryFindVisible(input);
  }

  async getByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate> {
    const template = await this.repository.tryFindVisible(input);
    if (!template) throw new TemplateNotFoundError(input.id);
    return template;
  }

  async createOrgTemplate(
    input: CreateIngestionTemplateInput,
  ): Promise<IngestionTemplate> {
    const parsed = createIngestionTemplateInputSchema.parse(input);
    if (!ingestionTemplateSourceTypeSchema.safeParse(parsed.sourceType).success) {
      throw new InvalidSourceTypeError();
    }
    return this.repository.createWithAudit({
      template: {
        organizationId: parsed.organizationId,
        slug: this.createSlug(parsed.displayName),
        sourceType: parsed.sourceType,
        displayName: parsed.displayName,
        description: parsed.description ?? null,
        iconAsset: parsed.iconAsset ?? null,
        credentialSchema: parsed.credentialSchema ?? null,
        ottlRules: parsed.ottlRules ?? "",
      },
      callerUserId: parsed.callerUserId,
      surface: parsed.surface ?? DEFAULT_GOVERNANCE_SURFACE,
    });
  }

  async updateOttlRules(
    input: UpdateIngestionTemplateOttlInput,
  ): Promise<IngestionTemplate> {
    const parsed = updateIngestionTemplateOttlInputSchema.parse(input);
    const result = await this.repository.updateOttlRulesWithAudit({
      ...parsed,
      surface: parsed.surface ?? DEFAULT_GOVERNANCE_SURFACE,
    });
    if (result.status === "platform") {
      throw new PlatformTemplateImmutableError();
    }
    if (result.status === "not_found") {
      throw new TemplateNotFoundError(parsed.id);
    }
    return result.template;
  }

  async archiveOrgTemplate(input: ArchiveIngestionTemplateInput): Promise<void> {
    const parsed = archiveIngestionTemplateInputSchema.parse(input);
    const result = await this.repository.archiveWithAudit({
      ...parsed,
      surface: parsed.surface ?? DEFAULT_GOVERNANCE_SURFACE,
      archivedAt: this.now(),
    });
    if (result.status === "platform") {
      throw new PlatformTemplateImmutableError();
    }
    if (result.status === "not_found") {
      throw new TemplateNotFoundError(parsed.id);
    }
  }

  async cloneFromPlatform(
    input: CloneIngestionTemplateInput,
  ): Promise<IngestionTemplate> {
    const parsed = cloneIngestionTemplateInputSchema.parse(input);
    const source = await this.repository.tryFindPlatform(parsed.sourceTemplateId);
    if (!source) throw new TemplateNotFoundError(parsed.sourceTemplateId);
    return this.createOrgTemplate({
      organizationId: parsed.organizationId,
      callerUserId: parsed.callerUserId,
      sourceType: source.sourceType,
      displayName: `${source.displayName} (custom)`,
      description: source.description,
      iconAsset: source.iconAsset,
      credentialSchema: source.credentialSchema,
      ottlRules: source.ottlRules,
      surface: parsed.surface,
    });
  }

  syncPlatformCatalog(): Promise<PlatformIngestionTemplateSyncResult> {
    return this.repository.syncPlatformCatalog({
      templates: PLATFORM_INGESTION_TEMPLATES,
      retiredSlugs: RETIRED_PLATFORM_TEMPLATE_SLUGS,
      archivedAt: this.now(),
    });
  }

  private createSlug(displayName: string): string {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    return `${base || "custom"}_${this.newSlugSuffix()}`;
  }
}
