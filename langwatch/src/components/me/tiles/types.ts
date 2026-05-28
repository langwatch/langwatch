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
  /**
   * Legacy single-scope shape, retained for back-compat reads while the
   * service layer migrates to `teamIds: string[]` (5aaa232d3 schema).
   */
  scope: AiToolScope;
  scopeId: string;
  /**
   * Multi-team scope (post-5aaa232d3). Empty array = whole organization.
   * Non-empty = restricted to those teams. May be undefined on older
   * cached responses; treat as empty array.
   */
  teamIds?: string[];
  type: AiToolTileType;
  displayName: string;
  slug: string;
  /**
   * Legacy preset-key icon lookup (e.g. "anthropic"). Kept for back-compat
   * reads. New writes go to `iconAsset`; resolver prefers iconAsset when
   * both present.
   */
  iconKey?: string;
  /**
   * Prefix-discriminated icon source (5aaa232d3):
   *   "preset:claude_code" / "preset:codex" / ... → built-in icon
   *   "data:image/svg+xml;base64,..."             → admin-uploaded
   *   null/undefined                              → fall back to iconKey
   *                                                  or type-default
   */
  iconAsset?: string | null;
  order: number;
  enabled: boolean;
  config:
    | CodingAssistantConfig
    | ModelProviderConfig
    | ExternalToolConfig;
}
