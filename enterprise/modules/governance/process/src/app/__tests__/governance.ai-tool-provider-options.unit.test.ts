// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";
/**
 * Which catalogue `aiToolProviders` answers from: the platform's static
 * provider registry, not the organization's configured providers. The admin
 * picker marks each row `configured`, so a list of only-configured providers
 * makes that flag constant-true and leaves an admin nothing new to pick.
 */
import { describe, expect, it, vi } from "vitest";

import {
  AiToolCatalogRepository,
  type AiToolSlug,
} from "../../repositories/ai-tool-catalog.repository.ts";
import { DefaultGovernanceAiToolCatalogService } from "../../services/ai-tool-catalog.service.ts";
import { ModelProviderAiToolCatalogService } from "../../services/ai-tool-provider-catalog.service.ts";

const entry: AiToolEntry = {
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
  config: { assistantKind: "cursor", setupCommand: "langwatch cursor", allowOtelDirect: true },
  archivedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  createdById: null,
  updatedById: null,
};

/** One organization that has configured exactly one provider. */
class OneConfiguredProviderCatalog extends AiToolCatalogRepository {
  findVisible = vi.fn(async () => [entry]);
  findAdmin = vi.fn(async () => [entry]);
  findById = vi.fn(async () => entry);
  departmentsBelongToOrganization = vi.fn(async () => true);
  create = vi.fn(async () => entry);
  update = vi.fn(async () => entry);
  remove = vi.fn(async () => entry);
  ensureDefaultCatalog = vi.fn(async () => ({ hasSeeded: true, created: 0 }));
  seedStarterPack = vi.fn(async () => ({ created: 0, updated: 0, skipped: 0 }));
  findConfiguredProvidersForUser = vi.fn(async () => ["openai"]);
  findConfiguredProvidersForOrganization = vi.fn(async () => ["openai"]);
  findRoutingPolicyOptions = vi.fn(async () => []);
  reorder = vi.fn(async () => undefined);
}

class FixedSlug implements AiToolSlug {
  generate = vi.fn(() => "generated-slug");
}

/** One row of the admin picker: a provider, and whether this organization has it. */
type ProviderPickerRow = {
  providerKey: string;
  displayName: string;
  configured: boolean;
};

/** The picker's answer for an organization holding exactly one configured provider. */
async function providerPickerRows(): Promise<ProviderPickerRow[]> {
  const catalogue = DefaultGovernanceAiToolCatalogService.create({
    repository: new OneConfiguredProviderCatalog(),
    slugs: new FixedSlug(),
    providers: ModelProviderAiToolCatalogService.create(),
  });

  return catalogue.listProviderOptionsForAdmin({ organizationId: "organization" });
}

describe("given an organization that has configured one model provider", () => {
  describe("when an admin opens the AI tool provider picker", () => {
    it("offers providers the organization has not configured", async () => {
      const options = await providerPickerRows();

      expect(options.filter((option) => !option.configured).length).toBeGreaterThan(0);
    });

    it("marks the one the organization has as configured", async () => {
      const options = await providerPickerRows();

      expect(options.find((option) => option.providerKey === "openai")?.configured).toBe(true);
    });

    it("names more providers than the organization has configured", async () => {
      const options = await providerPickerRows();

      expect(options.length).toBeGreaterThan(1);
    });
  });
});
