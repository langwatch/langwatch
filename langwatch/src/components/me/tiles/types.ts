/**
 * AI Tools Portal — tile type contract.
 *
 * Mirrors Sergey's `AiToolEntry` Prisma model (Phase 7 backend). See:
 *   .claude/AI-TOOLS-PORTAL-LANE-B-UI.md
 *   <Sergey's Phase 7 architecture sketch in #langwatch-ai-gateway>
 *
 * Lane-B holds this shape locally as the source of truth for components
 * until Sergey's `api.aiTools.list` lands; B9 swaps the import to the
 * generated tRPC type.
 */

export type AiToolTileType =
  | "coding_assistant"
  | "model_provider"
  | "external_tool";

export type AiToolScope = "organization" | "team";

export interface CodingAssistantConfig {
  setupCommand: string;
  setupDocsUrl?: string;
  helperText?: string;
}

export interface ModelProviderConfig {
  providerKey: string;
  suggestedRoutingPolicyId?: string;
  defaultLabel?: string;
  projectSuggestionText?: string;
}

export interface ExternalToolConfig {
  descriptionMarkdown: string;
  linkUrl: string;
  ctaLabel?: string;
}

export type AiToolConfig =
  | { type: "coding_assistant"; config: CodingAssistantConfig }
  | { type: "model_provider"; config: ModelProviderConfig }
  | { type: "external_tool"; config: ExternalToolConfig };

export interface AiToolEntry {
  id: string;
  scope: AiToolScope;
  scopeId: string;
  type: AiToolTileType;
  displayName: string;
  slug: string;
  iconKey?: string;
  order: number;
  enabled: boolean;
  config:
    | CodingAssistantConfig
    | ModelProviderConfig
    | ExternalToolConfig;
}
