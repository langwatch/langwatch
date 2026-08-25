import type {
  AiToolEntry,
  AiToolMemberInput,
  AiToolStarterTile,
  AiToolType,
  CreateAiToolEntryInput,
  ReorderAiToolEntriesInput,
  SeedAiToolStarterPackInput,
  UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";

export abstract class AiToolCatalogRepository {
  abstract listVisible(input: {
    organizationId: string;
    userId: string;
    type?: AiToolType;
  }): Promise<AiToolEntry[]>;
  abstract listAdmin(organizationId: string): Promise<AiToolEntry[]>;
  abstract tryFindById(id: string): Promise<AiToolEntry | null>;
  abstract departmentsBelongToOrganization(input: {
    organizationId: string;
    departmentIds: string[];
  }): Promise<boolean>;
  abstract create(input: {
    values: CreateAiToolEntryInput;
    slug: string;
  }): Promise<AiToolEntry>;
  abstract update(input: UpdateAiToolEntryInput): Promise<AiToolEntry>;
  abstract remove(id: string): Promise<AiToolEntry>;
  abstract ensureDefaultCatalog(input: {
    organizationId: string;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ hasSeeded: boolean; created: number }>;
  abstract seedStarterPack(input: {
    values: SeedAiToolStarterPackInput;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ created: number; updated: number; skipped: number }>;
  abstract listConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]>;
  abstract listConfiguredProvidersForOrganization(
    organizationId: string,
  ): Promise<string[]>;
  abstract listRoutingPolicyOptions(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>>;
  abstract reorder(input: ReorderAiToolEntriesInput): Promise<void>;
}

export abstract class AiToolSlugPort {
  abstract generate(displayName: string): string;
}

export abstract class AiToolProviderCatalogPort {
  abstract list(): Array<{
    providerKey: string;
    displayName: string;
    type: string;
  }>;
}
