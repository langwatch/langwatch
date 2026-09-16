/** Temporary local tile type; mirrors the backend AI tools model until tRPC type lands. */

export type AiToolTileType = "coding_assistant" | "model_provider" | "external_tool";

export type AiToolScope = "organization" | "department" | "team";

export interface CodingAssistantConfig {
  setupCommand: string;
  setupDocsUrl?: string;
  helperText?: string;
  /**
   * CLI path policy folded into the tile. Both default to `true` when
   * absent; "cursor" forces `allowOtelDirect = false` (GUI-only — no
   * terminal OTLP reaches the agent panel). Read by cliBootstrap.
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
   * Prefix-discriminated icon source: `preset:*` is a built-in icon,
   * `data:image/svg+xml;base64,...` is admin-uploaded, and null/undefined
   * falls back to iconKey or the type-default.
   */
  iconAsset?: string | null;
  order: number;
  enabled: boolean;
  config: CodingAssistantConfig | ModelProviderConfig | ExternalToolConfig;
}
