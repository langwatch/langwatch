import { AI_TOOL_STARTER_TILES, type AiToolEntry } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  AiToolCatalogRepository,
  type AiToolProviderCatalog,
  type AiToolSlug,
} from "../../repositories/ai-tool-catalog.repository.ts";
import { DefaultGovernanceAiToolCatalogService } from "../ai-tool-catalog.service.ts";

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
  findVisible = vi.fn(async () => [tile]);
  findAdmin = vi.fn(async () => [tile]);
  findById = vi.fn(async () => tile);
  departmentsBelongToOrganization = vi.fn(async () => true);
  create = vi.fn(async () => tile);
  update = vi.fn(async () => tile);
  remove = vi.fn(async () => tile);
  ensureDefaultCatalog = vi.fn(async (input) => ({
    hasSeeded: true,
    created: input.tiles.length,
  }));
  seedStarterPack = vi.fn(async () => ({ created: 1, updated: 0, skipped: 0 }));
  findConfiguredProvidersForUser = vi.fn(async () => ["openai"]);
  findConfiguredProvidersForOrganization = vi.fn(async () => ["openai"]);
  findRoutingPolicyOptions = vi.fn(async () => []);
  reorder = vi.fn(async () => undefined);
}

class FixedSlug implements AiToolSlug {
  generate = vi.fn(() => "generated-slug");
}

class FixedProviders implements AiToolProviderCatalog {
  findAll() {
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
    ).rejects.toThrow(ZodError);
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
