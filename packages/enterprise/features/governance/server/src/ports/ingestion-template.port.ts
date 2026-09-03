import type {
  GovernanceCallSurface,
  IngestionTemplate,
  PlatformIngestionTemplateSeed,
  PlatformIngestionTemplateSyncResult,
} from "@langwatch/enterprise-governance-contract";

export type NewIngestionTemplate = Omit<
  IngestionTemplate,
  "id" | "platformPublished" | "enabled"
>;

export type IngestionTemplateMutationResult =
  | { status: "updated"; template: IngestionTemplate }
  | { status: "platform" }
  | { status: "not_found" };

export abstract class IngestionTemplateRepository {
  abstract listUserVisible(organizationId: string): Promise<IngestionTemplate[]>;
  abstract listAdminVisible(organizationId: string): Promise<IngestionTemplate[]>;
  abstract tryFindVisible(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null>;
  abstract tryFindPlatform(id: string): Promise<IngestionTemplate | null>;
  abstract createWithAudit(input: {
    template: NewIngestionTemplate;
    callerUserId: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplate>;
  abstract updateOttlRulesWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    ottlRules: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplateMutationResult>;
  abstract archiveWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    surface: GovernanceCallSurface;
    archivedAt: Date;
  }): Promise<IngestionTemplateMutationResult>;
  abstract syncPlatformCatalog(input: {
    templates: readonly PlatformIngestionTemplateSeed[];
    retiredSlugs: readonly string[];
    archivedAt: Date;
  }): Promise<PlatformIngestionTemplateSyncResult>;
}
