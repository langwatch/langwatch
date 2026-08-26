// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AiToolMemberInput,
  AiToolOrganizationInput,
  AiToolCliCatalog,
  AiToolEntry,
  AiToolProviderOption,
  CreateAiToolEntryInput,
  FindAiToolEntryInput,
  PlatformToolSlug,
  PlatformToolPolicy,
  PlatformToolPolicyMap,
  ReorderAiToolEntriesInput,
  SeedAiToolStarterPackInput,
  UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";
import type { DefaultGovernanceAiToolCatalogService } from "./ai-tool-catalog.service";

/** Internal collaborator for the AI-tool portion of GovernanceService. */
export class GovernanceAiToolsService {
  private constructor(private readonly catalog: DefaultGovernanceAiToolCatalogService) {}

  static create(
    catalog: DefaultGovernanceAiToolCatalogService,
  ): GovernanceAiToolsService {
    return new GovernanceAiToolsService(catalog);
  }

  listForUser(input: AiToolMemberInput): Promise<AiToolEntry[]> {
    return this.catalog.listForUser(input);
  }

  listForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]> {
    return this.catalog.listForAdmin(input);
  }

  tryFindById(input: FindAiToolEntryInput): Promise<AiToolEntry | null> {
    return this.catalog.tryFindById(input);
  }

  getById(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    return this.catalog.getById(input);
  }

  create(input: CreateAiToolEntryInput): Promise<AiToolEntry> {
    return this.catalog.create(input);
  }

  update(input: UpdateAiToolEntryInput): Promise<AiToolEntry> {
    return this.catalog.update(input);
  }

  remove(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    return this.catalog.remove(input);
  }

  ensureDefaultCatalog(
    input: AiToolOrganizationInput,
  ): Promise<{ hasSeeded: boolean; created: number }> {
    return this.catalog.ensureDefaultCatalog(input);
  }

  seedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    return this.catalog.seedStarterPack(input);
  }

  listConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]> {
    return this.catalog.listConfiguredProvidersForUser(input);
  }

  listProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]> {
    return this.catalog.listProviderOptionsForAdmin(input);
  }

  listRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.catalog.listRoutingPolicyOptionsForAdmin(input);
  }

  reorder(input: ReorderAiToolEntriesInput): Promise<void> {
    return this.catalog.reorder(input);
  }

  resolveToolPolicyOverrides(
    input: AiToolMemberInput,
  ): Promise<Partial<Record<PlatformToolSlug, PlatformToolPolicy>>> {
    return this.catalog.resolveToolPolicyOverrides(input);
  }

  resolveToolPolicyMap(input: AiToolMemberInput): Promise<PlatformToolPolicyMap> {
    return this.catalog.resolveToolPolicyMap(input);
  }

  resolveToolPolicy(
    input: AiToolMemberInput & { slug: PlatformToolSlug },
  ): Promise<PlatformToolPolicy> {
    return this.catalog.resolveToolPolicy(input);
  }

  resolveCliCatalogForUser(input: AiToolMemberInput): Promise<AiToolCliCatalog> {
    return this.catalog.resolveCliCatalogForUser(input);
  }
}
