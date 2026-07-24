/**
 * AI Tools Portal - tile type contract.
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

export type AiToolScope = "organization" | "department" | "team";

export interface CodingAssistantConfig {
  setupCommand: string;
  setupDocsUrl?: string;
  helperText?: string;
  /**
   * CLI path policy folded into the tile (replaces the standalone
   * PlatformToolPolicy table). Both default to `true` when absent. The
   * "cursor" assistant forces `allowOtelDirect = false` (GUI-only, no
   * terminal OTLP env reaches the agent panel). Read by cliBootstrap to
   * derive the login `toolPolicies` map.
   */
  allowVk?: boolean;
  allowOtelDirect?: boolean;
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
   * Legacy single-scope shape, retained for back-compat reads. New writes
   * produce scope='organization' (org-wide) or scope='department'.
   */
  scope: AiToolScope;
  scopeId: string;
  /**
   * Department scope. Empty array = whole organization. Non-empty =
   * visible only to members of those departments. May be undefined on
   * older cached responses; treat as empty array.
   */
  departmentIds?: string[];
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
