import { describe, expect, it, vi } from "vitest";
import { AI_TOOL_STARTER_TILES, type AiToolEntry } from "@langwatch/enterprise-governance-contract";
import {
  AiToolCatalogRepository,
  AiToolProviderCatalogPort,
  AiToolSlugPort,
} from "../ai-tool-catalog.port";
import { DefaultGovernanceAiToolCatalogService } from "../../services/ai-tool-catalog.service";

const tile: AiToolEntry = {
  id: "tile",
  organizationId: "organization",
  scope: "organization",
  scopeId: "organization",
  departmentIds: [],
  type: "coding_assistant",
  displayName: "Cursor",
  slug: "cursor",
  iconKey: null,
  iconAsset: "preset:cursor",
  order: 0,
  enabled: true,
  config: {
    assistantKind: "cursor",
    setupCommand: "langwatch cursor",
    allowOtelDirect: true,
  },
  archivedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  createdById: null,
  updatedById: null,
};

class MemoryCatalog extends AiToolCatalogRepository {
  listVisible = vi.fn(async () => [tile]);
  listAdmin = vi.fn(async () => [tile]);
  tryFindById = vi.fn(async () => tile);
  departmentsBelongToOrganization = vi.fn(async () => true);
  create = vi.fn(async () => tile);
  update = vi.fn(async () => tile);
  remove = vi.fn(async () => tile);
  ensureDefaultCatalog = vi.fn(async (input) => ({
    hasSeeded: true,
    created: input.tiles.length,
  }));
  seedStarterPack = vi.fn(async () => ({ created: 1, updated: 0, skipped: 0 }));
  listConfiguredProvidersForUser = vi.fn(async () => ["openai"]);
  listConfiguredProvidersForOrganization = vi.fn(async () => ["openai"]);
  listRoutingPolicyOptions = vi.fn(async () => []);
  reorder = vi.fn(async () => undefined);
}

class FixedSlug extends AiToolSlugPort {
  generate = vi.fn(() => "generated-slug");
}

class FixedProviders extends AiToolProviderCatalogPort {
  list() {
    return [
      { providerKey: "openai", displayName: "OpenAI", type: "llm" },
      { providerKey: "embed", displayName: "Embed", type: "embedding" },
    ];
  }
}

function service(repository = new MemoryCatalog()) {
  return DefaultGovernanceAiToolCatalogService.create({
    repository,
    slugs: new FixedSlug(),
    providers: new FixedProviders(),
  });
}

describe("DefaultGovernanceAiToolCatalogService", () => {
  it("keeps Cursor direct OTLP disabled regardless of stored config", async () => {
    const policy = await service().resolveToolPolicy({
      organizationId: "organization",
      userId: "user",
      slug: "cursor",
    });
    expect(policy).toEqual({ allowVk: true, allowOtelDirect: false });
  });

  it("validates the per-type config before persistence", async () => {
    const repository = new MemoryCatalog();
    await expect(
      service(repository).create({
        organizationId: "organization",
        departmentIds: [],
        type: "model_provider",
        displayName: "Broken",
        config: { setupCommand: "wrong shape" },
      }),
    ).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("provisions the complete canonical starter catalog", async () => {
    const repository = new MemoryCatalog();
    const result = await service(repository).ensureDefaultCatalog({
      organizationId: "organization",
    });
    expect(result.created).toBe(AI_TOOL_STARTER_TILES.length);
  });
});
