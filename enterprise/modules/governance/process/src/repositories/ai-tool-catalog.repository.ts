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
  abstract findVisible(input: {
    organizationId: string;
    userId: string;
    type?: AiToolType;
  }): Promise<AiToolEntry[]>;
  abstract findAdmin(organizationId: string): Promise<AiToolEntry[]>;
  abstract findById(id: string): Promise<AiToolEntry | null>;
  abstract departmentsBelongToOrganization(input: {
    organizationId: string;
    departmentIds: string[];
  }): Promise<boolean>;
  abstract create(input: { values: CreateAiToolEntryInput; slug: string }): Promise<AiToolEntry>;
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
  abstract findConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]>;
  abstract findConfiguredProvidersForOrganization(organizationId: string): Promise<string[]>;
  abstract findRoutingPolicyOptions(
    organizationId: string,
  ): Promise<{ id: string; name: string }[]>;
  abstract reorder(input: ReorderAiToolEntriesInput): Promise<void>;
}

/** How a catalogue entry's stable slug is minted from its display name. */
export interface AiToolSlug {
  generate(displayName: string): string;
}

/** The model providers this deployment can offer a catalogue entry. */
export interface AiToolProviderCatalog {
  findAll(): {
    providerKey: string;
    displayName: string;
    type: string;
  }[];
}
