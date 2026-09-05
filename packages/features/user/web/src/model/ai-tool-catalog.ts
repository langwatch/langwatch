/**
 * The AI-tool catalogue as the personal portal reads it.
 *
 * Written out here rather than imported from
 * `@langwatch/enterprise-governance-contract`: the portal is core and the
 * catalogue's authoring side is enterprise, so a core screen may read the
 * shape but may not depend on the package that owns it. The wire shape is
 * `aiToolEntrySchema` in that contract — a field added there reaches the
 * portal only once it is added here too.
 */

/** The kind of tile a catalogue entry renders as. */
export type AiToolType = "coding_assistant" | "model_provider" | "external_tool";

/** The scope a catalogue entry is published at. */
export type AiToolScope = "organization" | "department" | "team";

/** The coding assistant a `coding_assistant` tile stands for. */
export type AssistantKind =
  | "claude_code"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor"
  | "github_copilot"
  | "custom";

/** The configuration one tile carries, discriminated by its tile type. */
export type AiToolConfigEnvelope =
  | {
      type: "coding_assistant";
      config: {
        assistantKind?: AssistantKind | undefined;
        setupCommand: string;
        setupDocsUrl?: string | undefined;
        helperText?: string | undefined;
        allowVk?: boolean | undefined;
        allowOtelDirect?: boolean | undefined;
        bundledPlan?: boolean | undefined;
      };
    }
  | {
      type: "model_provider";
      config: {
        providerKey: string;
        suggestedRoutingPolicyId?: string | undefined;
        defaultLabel?: string | undefined;
        projectSuggestionText?: string | undefined;
      };
    }
  | {
      type: "external_tool";
      config: {
        descriptionMarkdown: string;
        linkUrl: string;
        ctaLabel?: string | undefined;
      };
    };

/** One catalogue entry, as the read hands it over. */
export type AiToolEntry = {
  id: string;
  organizationId: string;
  scope: AiToolScope;
  scopeId: string;
  departmentIds: string[];
  type: AiToolType;
  displayName: string;
  slug: string;
  iconKey: string | null;
  iconAsset: string | null;
  order: number;
  enabled: boolean;
  config: Record<string, unknown>;
  archivedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  createdById: string | null;
  updatedById: string | null;
};
