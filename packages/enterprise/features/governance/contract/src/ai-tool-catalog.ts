import { z } from "zod";
import type {
  PlatformToolPolicy,
  PlatformToolPolicyMap,
  PlatformToolSlug,
} from "./platform-tool-policy";

export const AI_TOOL_TYPES = ["coding_assistant", "model_provider", "external_tool"] as const;
export const aiToolTypeSchema = z.enum(AI_TOOL_TYPES);
export type AiToolType = z.infer<typeof aiToolTypeSchema>;

export const AI_TOOL_SCOPES = ["organization", "department", "team"] as const;
export const aiToolScopeSchema = z.enum(AI_TOOL_SCOPES);
export type AiToolScope = z.infer<typeof aiToolScopeSchema>;

export const ASSISTANT_KINDS = [
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "github_copilot",
  "custom",
] as const;
export const assistantKindSchema = z.enum(ASSISTANT_KINDS);
export type AssistantKind = z.infer<typeof assistantKindSchema>;

export const ASSISTANT_KIND_TO_TOOL_SLUG: Partial<Record<AssistantKind, PlatformToolSlug>> = {
  claude_code: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  cursor: "cursor",
  github_copilot: "copilot",
};

export const codingAssistantConfigSchema = z.object({
  assistantKind: assistantKindSchema.optional(),
  setupCommand: z.string().min(1).max(256),
  setupDocsUrl: z.string().url().max(2048).optional(),
  helperText: z.string().max(2048).optional(),
  allowVk: z.boolean().optional(),
  allowOtelDirect: z.boolean().optional(),
  bundledPlan: z.boolean().optional(),
});

export const modelProviderToolConfigSchema = z.object({
  providerKey: z.string().min(1).max(64),
  suggestedRoutingPolicyId: z.string().min(1).optional(),
  defaultLabel: z.string().max(64).optional(),
  projectSuggestionText: z.string().max(512).optional(),
});

export const externalToolConfigSchema = z.object({
  descriptionMarkdown: z.string().max(8192),
  linkUrl: z.string().url().max(2048),
  ctaLabel: z.string().max(64).optional(),
});

export const aiToolConfigEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("coding_assistant"),
    config: codingAssistantConfigSchema,
  }),
  z.object({
    type: z.literal("model_provider"),
    config: modelProviderToolConfigSchema,
  }),
  z.object({
    type: z.literal("external_tool"),
    config: externalToolConfigSchema,
  }),
]);
export type AiToolConfigEnvelope = z.infer<typeof aiToolConfigEnvelopeSchema>;
export type AiToolConfig = AiToolConfigEnvelope["config"];

const configRecordSchema = z.record(z.string(), z.unknown());

export const aiToolEntrySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    scope: aiToolScopeSchema,
    scopeId: z.string().min(1),
    departmentIds: z.array(z.string().min(1)),
    type: aiToolTypeSchema,
    displayName: z.string().min(1),
    slug: z.string().min(1),
    iconKey: z.string().nullable(),
    iconAsset: z.string().nullable(),
    order: z.number().int(),
    enabled: z.boolean(),
    config: configRecordSchema,
    archivedAtMs: z.number().int().nonnegative().nullable(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    createdById: z.string().nullable(),
    updatedById: z.string().nullable(),
  })
  .strict();
export type AiToolEntry = z.infer<typeof aiToolEntrySchema>;

export const aiToolOrganizationInputSchema = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export type AiToolOrganizationInput = z.infer<typeof aiToolOrganizationInputSchema>;

export const aiToolMemberInputSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
export type AiToolMemberInput = z.infer<typeof aiToolMemberInputSchema>;

export const findAiToolEntryInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type FindAiToolEntryInput = z.infer<typeof findAiToolEntryInputSchema>;

export const createAiToolEntryInputSchema = z
  .object({
    organizationId: z.string().min(1),
    departmentIds: z.array(z.string().min(1)),
    type: aiToolTypeSchema,
    displayName: z.string().min(1),
    iconAsset: z.string().nullable().optional(),
    order: z.number().int().optional(),
    config: configRecordSchema,
    actorUserId: z.string().nullable().optional(),
  })
  .strict();
export type CreateAiToolEntryInput = z.infer<typeof createAiToolEntryInputSchema>;

export const updateAiToolEntryInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    iconAsset: z.string().nullable().optional(),
    departmentIds: z.array(z.string().min(1)).optional(),
    order: z.number().int().optional(),
    enabled: z.boolean().optional(),
    type: aiToolTypeSchema.optional(),
    config: configRecordSchema.optional(),
    actorUserId: z.string().nullable().optional(),
  })
  .strict();
export type UpdateAiToolEntryInput = z.infer<typeof updateAiToolEntryInputSchema>;

export const reorderAiToolEntriesInputSchema = aiToolOrganizationInputSchema
  .extend({
    updates: z.array(z.object({ id: z.string().min(1), order: z.number().int() }).strict()),
  })
  .strict();
export type ReorderAiToolEntriesInput = z.infer<typeof reorderAiToolEntriesInputSchema>;

export const seedAiToolStarterPackInputSchema = aiToolOrganizationInputSchema
  .extend({
    actorUserId: z.string().nullable().optional(),
    slugs: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SeedAiToolStarterPackInput = z.infer<typeof seedAiToolStarterPackInputSchema>;

export type AiToolStarterTile = {
  type: AiToolType;
  slug: string;
  displayName: string;
  iconAsset: string;
  config: Record<string, unknown>;
};

export const AI_TOOL_STARTER_TILES: readonly AiToolStarterTile[] = [
  {
    type: "coding_assistant",
    slug: "claude-code",
    displayName: "Claude Code",
    iconAsset: "preset:claude_code",
    config: {
      assistantKind: "claude_code",
      setupCommand: "langwatch claude",
      setupDocsUrl: "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "codex",
    displayName: "Codex",
    iconAsset: "preset:codex",
    config: {
      assistantKind: "codex",
      setupCommand: "langwatch codex",
      setupDocsUrl: "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "gemini",
    displayName: "Gemini CLI",
    iconAsset: "preset:gemini",
    config: {
      assistantKind: "gemini",
      setupCommand: "langwatch gemini",
      setupDocsUrl: "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "opencode",
    displayName: "opencode",
    iconAsset: "preset:opencode",
    config: {
      assistantKind: "opencode",
      setupCommand: "langwatch opencode",
      setupDocsUrl: "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "github-copilot",
    displayName: "GitHub Copilot CLI",
    iconAsset: "preset:github_copilot",
    config: {
      assistantKind: "github_copilot",
      setupCommand: "langwatch copilot",
      setupDocsUrl: "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "model_provider",
    slug: "openai",
    displayName: "OpenAI",
    iconAsset: "preset:openai",
    config: {
      providerKey: "openai",
      defaultLabel: "openai-key",
      projectSuggestionText: "Building an app? Create a project to track its usage separately.",
    },
  },
  {
    type: "model_provider",
    slug: "anthropic",
    displayName: "Anthropic",
    iconAsset: "preset:anthropic",
    config: { providerKey: "anthropic", defaultLabel: "anthropic-key" },
  },
  {
    type: "model_provider",
    slug: "bedrock",
    displayName: "AWS Bedrock",
    iconAsset: "preset:bedrock",
    config: { providerKey: "bedrock", defaultLabel: "bedrock-key" },
  },
  {
    type: "model_provider",
    slug: "google",
    displayName: "Google AI",
    iconAsset: "preset:google",
    config: { providerKey: "google", defaultLabel: "google-key" },
  },
];

export type AiToolCliCatalog = {
  tools: Array<{ slug: string; displayName: string }>;
  providers: Array<{
    providerKey: string;
    displayName: string;
    configured: boolean;
  }>;
  configuredProviderKeys: string[];
};

export type AiToolProviderOption = {
  providerKey: string;
  displayName: string;
  configured: boolean;
};

export class AiToolEntryNotFoundError extends Error {
  constructor(
    readonly entryId: string,
    readonly organizationId: string,
  ) {
    super(`AI tool entry ${entryId} was not found in organization ${organizationId}`);
    this.name = "AiToolEntryNotFoundError";
  }
}

export class AiToolDepartmentScopeError extends Error {
  constructor() {
    super("One or more departments do not belong to this organization");
    this.name = "AiToolDepartmentScopeError";
  }
}
