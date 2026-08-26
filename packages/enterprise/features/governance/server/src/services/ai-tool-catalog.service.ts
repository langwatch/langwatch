import {
  AI_TOOL_STARTER_TILES,
  ASSISTANT_KIND_TO_TOOL_SLUG,
  AiToolDepartmentScopeError,
  AiToolEntryNotFoundError,
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUGS,
  aiToolConfigEnvelopeSchema,
  aiToolMemberInputSchema,
  aiToolOrganizationInputSchema,
  createAiToolEntryInputSchema,
  findAiToolEntryInputSchema,
  reorderAiToolEntriesInputSchema,
  seedAiToolStarterPackInputSchema,
  updateAiToolEntryInputSchema,
  type AiToolCliCatalog,
  type AiToolEntry,
  type AiToolMemberInput,
  type AiToolOrganizationInput,
  type AiToolProviderOption,
  type CreateAiToolEntryInput,
  type FindAiToolEntryInput,
  type PlatformToolPolicy,
  type PlatformToolPolicyMap,
  type PlatformToolSlug,
  type ReorderAiToolEntriesInput,
  type SeedAiToolStarterPackInput,
  type UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";
import type {
  AiToolCatalogRepository,
  AiToolProviderCatalogPort,
  AiToolSlugPort,
} from "../ports/ai-tool-catalog.port";

export class DefaultGovernanceAiToolCatalogService {
  private constructor(
    private readonly repository: AiToolCatalogRepository,
    private readonly slugs: AiToolSlugPort,
    private readonly providers: AiToolProviderCatalogPort,
  ) {}

  static create(options: {
    repository: AiToolCatalogRepository;
    slugs: AiToolSlugPort;
    providers: AiToolProviderCatalogPort;
  }): DefaultGovernanceAiToolCatalogService {
    return new DefaultGovernanceAiToolCatalogService(
      options.repository,
      options.slugs,
      options.providers,
    );
  }

  static listStarterPackTiles(): Array<{
    slug: string;
    displayName: string;
    type: AiToolEntry["type"];
  }> {
    return AI_TOOL_STARTER_TILES.map((tile) => ({
      slug: tile.slug,
      displayName: tile.displayName,
      type: tile.type,
    }));
  }

  listForUser(input: AiToolMemberInput): Promise<AiToolEntry[]> {
    return this.repository.listVisible(aiToolMemberInputSchema.parse(input));
  }

  listForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]> {
    const parsed = aiToolOrganizationInputSchema.parse(input);
    return this.repository.listAdmin(parsed.organizationId);
  }

  async tryFindById(input: FindAiToolEntryInput): Promise<AiToolEntry | null> {
    const parsed = findAiToolEntryInputSchema.parse(input);
    const entry = await this.repository.tryFindById(parsed.id);
    return entry?.organizationId === parsed.organizationId ? entry : null;
  }

  async getById(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    const parsed = findAiToolEntryInputSchema.parse(input);
    return this.getOwn(parsed.id, parsed.organizationId);
  }

  async create(input: CreateAiToolEntryInput): Promise<AiToolEntry> {
    const parsed = createAiToolEntryInputSchema.parse(input);
    aiToolConfigEnvelopeSchema.parse({
      type: parsed.type,
      config: parsed.config,
    });
    await this.assertDepartments(parsed.organizationId, parsed.departmentIds);
    return this.repository.create({
      values: parsed,
      slug: this.slugs.generate(parsed.displayName),
    });
  }

  async update(input: UpdateAiToolEntryInput): Promise<AiToolEntry> {
    const parsed = updateAiToolEntryInputSchema.parse(input);
    const existing = await this.getOwn(parsed.id, parsed.organizationId);
    if (parsed.config) {
      aiToolConfigEnvelopeSchema.parse({
        type: parsed.type ?? existing.type,
        config: parsed.config,
      });
    }
    if (parsed.departmentIds) {
      await this.assertDepartments(parsed.organizationId, parsed.departmentIds);
    }
    return this.repository.update(parsed);
  }

  async remove(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    const parsed = findAiToolEntryInputSchema.parse(input);
    await this.getOwn(parsed.id, parsed.organizationId);
    return this.repository.remove(parsed.id);
  }

  ensureDefaultCatalog(
    input: AiToolOrganizationInput,
  ): Promise<{ hasSeeded: boolean; created: number }> {
    const parsed = aiToolOrganizationInputSchema.parse(input);
    return this.repository.ensureDefaultCatalog({
      organizationId: parsed.organizationId,
      tiles: AI_TOOL_STARTER_TILES,
    });
  }

  seedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const parsed = seedAiToolStarterPackInputSchema.parse(input);
    const selected = parsed.slugs
      ? AI_TOOL_STARTER_TILES.filter((tile) => parsed.slugs?.includes(tile.slug))
      : AI_TOOL_STARTER_TILES;
    return this.repository.seedStarterPack({ values: parsed, tiles: selected });
  }

  listConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]> {
    return this.repository.listConfiguredProvidersForUser(
      aiToolMemberInputSchema.parse(input),
    );
  }

  async listProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]> {
    const parsed = aiToolOrganizationInputSchema.parse(input);
    const configured = new Set(
      await this.repository.listConfiguredProvidersForOrganization(parsed.organizationId),
    );
    return this.providers
      .list()
      .filter(({ type }) => type === "llm")
      .map(({ providerKey, displayName }) => ({
        providerKey,
        displayName,
        configured: configured.has(providerKey),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  listRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<Array<{ id: string; name: string }>> {
    const parsed = aiToolOrganizationInputSchema.parse(input);
    return this.repository.listRoutingPolicyOptions(parsed.organizationId);
  }

  reorder(input: ReorderAiToolEntriesInput): Promise<void> {
    return this.repository.reorder(reorderAiToolEntriesInputSchema.parse(input));
  }

  async resolveToolPolicyOverrides(
    input: AiToolMemberInput,
  ): Promise<Partial<Record<PlatformToolSlug, PlatformToolPolicy>>> {
    const parsed = aiToolMemberInputSchema.parse(input);
    const tiles = await this.repository.listVisible({
      ...parsed,
      type: "coding_assistant",
    });
    const sorted = [...tiles].sort(
      (left, right) =>
        left.order - right.order || left.displayName.localeCompare(right.displayName),
    );
    const overrides: Partial<Record<PlatformToolSlug, PlatformToolPolicy>> = {};
    for (const tile of sorted) {
      const kind = tile.config.assistantKind;
      if (typeof kind !== "string") continue;
      const slug =
        ASSISTANT_KIND_TO_TOOL_SLUG[kind as keyof typeof ASSISTANT_KIND_TO_TOOL_SLUG];
      if (!slug || overrides[slug]) continue;
      let allowVk =
        tile.config.allowVk === undefined ? true : Boolean(tile.config.allowVk);
      let allowOtelDirect =
        tile.config.allowOtelDirect === undefined
          ? true
          : Boolean(tile.config.allowOtelDirect);
      if (slug === "code") allowVk = false;
      if (slug === "cursor") allowOtelDirect = false;
      overrides[slug] = { allowVk, allowOtelDirect };
    }
    return overrides;
  }

  async resolveToolPolicyMap(input: AiToolMemberInput): Promise<PlatformToolPolicyMap> {
    const overrides = await this.resolveToolPolicyOverrides(input);
    const result = {} as PlatformToolPolicyMap;
    for (const slug of PLATFORM_TOOL_SLUGS) {
      result[slug] = overrides[slug] ?? {
        ...PLATFORM_TOOL_POLICY_DEFAULTS[slug],
      };
    }
    return result;
  }

  async resolveToolPolicy(
    input: AiToolMemberInput & { slug: PlatformToolSlug },
  ): Promise<PlatformToolPolicy> {
    const policies = await this.resolveToolPolicyMap({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    return policies[input.slug];
  }

  async resolveCliCatalogForUser(input: AiToolMemberInput): Promise<AiToolCliCatalog> {
    const parsed = aiToolMemberInputSchema.parse(input);
    const [assistantTiles, providerTiles, configuredProviderKeys] = await Promise.all([
      this.repository.listVisible({
        ...parsed,
        type: "coding_assistant",
      }),
      this.repository.listVisible({ ...parsed, type: "model_provider" }),
      this.repository.listConfiguredProvidersForUser(parsed),
    ]);
    const configured = new Set(configuredProviderKeys);
    const tools: AiToolCliCatalog["tools"] = [];
    const seenTools = new Set<string>();
    for (const tile of sortTiles(assistantTiles)) {
      const kind = tile.config.assistantKind;
      if (typeof kind !== "string") continue;
      const slug =
        ASSISTANT_KIND_TO_TOOL_SLUG[kind as keyof typeof ASSISTANT_KIND_TO_TOOL_SLUG];
      if (!slug || seenTools.has(slug)) continue;
      seenTools.add(slug);
      tools.push({ slug, displayName: tile.displayName });
    }
    const providers: AiToolCliCatalog["providers"] = [];
    const seenProviders = new Set<string>();
    for (const tile of sortTiles(providerTiles)) {
      const providerKey = tile.config.providerKey;
      if (typeof providerKey !== "string" || seenProviders.has(providerKey)) {
        continue;
      }
      seenProviders.add(providerKey);
      providers.push({
        providerKey,
        displayName: tile.displayName,
        configured: configured.has(providerKey),
      });
    }
    return { tools, providers, configuredProviderKeys };
  }

  private async getOwn(id: string, organizationId: string): Promise<AiToolEntry> {
    const entry = await this.repository.tryFindById(id);
    if (!entry || entry.organizationId !== organizationId) {
      throw new AiToolEntryNotFoundError(id, organizationId);
    }
    return entry;
  }

  private async assertDepartments(
    organizationId: string,
    departmentIds: string[],
  ): Promise<void> {
    if (departmentIds.length === 0) return;
    const valid = await this.repository.departmentsBelongToOrganization({
      organizationId,
      departmentIds,
    });
    if (!valid) throw new AiToolDepartmentScopeError();
  }
}

function sortTiles(entries: AiToolEntry[]): AiToolEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.order - right.order || left.displayName.localeCompare(right.displayName),
  );
}
