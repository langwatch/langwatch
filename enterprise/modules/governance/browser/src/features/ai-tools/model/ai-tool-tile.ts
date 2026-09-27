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
