import { NotFoundError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { PlatformToolSlug } from "./platform-tool-policy.ts";

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

const codingAssistantConfigSchemaDefinition = z.object({
  assistantKind: assistantKindSchema.optional(),
  setupCommand: z.string().min(1).max(256),
  setupDocsUrl: z.string().url().max(2048).optional(),
  helperText: z.string().max(2048).optional(),
  allowVk: z.boolean().optional(),
  allowOtelDirect: z.boolean().optional(),
  bundledPlan: z.boolean().optional(),
});
export interface CodingAssistantConfigSchema extends Named<
  typeof codingAssistantConfigSchemaDefinition
> {}
export const codingAssistantConfigSchema: CodingAssistantConfigSchema =
  codingAssistantConfigSchemaDefinition;

const modelProviderToolConfigSchemaDefinition = z.object({
  providerKey: z.string().min(1).max(64),
  suggestedRoutingPolicyId: z.string().min(1).optional(),
  defaultLabel: z.string().max(64).optional(),
  projectSuggestionText: z.string().max(512).optional(),
});
export interface ModelProviderToolConfigSchema extends Named<
  typeof modelProviderToolConfigSchemaDefinition
> {}
export const modelProviderToolConfigSchema: ModelProviderToolConfigSchema =
  modelProviderToolConfigSchemaDefinition;

const externalToolConfigSchemaDefinition = z.object({
  descriptionMarkdown: z.string().max(8192),
  linkUrl: z.string().url().max(2048),
  ctaLabel: z.string().max(64).optional(),
});
export interface ExternalToolConfigSchema extends Named<
  typeof externalToolConfigSchemaDefinition
> {}
export const externalToolConfigSchema: ExternalToolConfigSchema =
  externalToolConfigSchemaDefinition;

const aiToolConfigEnvelopeSchemaDefinition = z.discriminatedUnion("type", [
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
export interface AiToolConfigEnvelopeSchema extends Named<
  typeof aiToolConfigEnvelopeSchemaDefinition
> {}
export const aiToolConfigEnvelopeSchema: AiToolConfigEnvelopeSchema =
  aiToolConfigEnvelopeSchemaDefinition;
export type AiToolConfigEnvelope = z.infer<typeof aiToolConfigEnvelopeSchema>;
export type AiToolConfig = AiToolConfigEnvelope["config"];

const configRecordSchema = z.record(z.string(), z.unknown());

const aiToolEntrySchemaDefinition = z
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
export interface AiToolEntrySchema extends Named<typeof aiToolEntrySchemaDefinition> {}
export const aiToolEntrySchema: AiToolEntrySchema = aiToolEntrySchemaDefinition;
export type AiToolEntry = z.infer<typeof aiToolEntrySchema>;

const aiToolOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface AiToolOrganizationInputSchema extends Named<
  typeof aiToolOrganizationInputSchemaDefinition
> {}
export const aiToolOrganizationInputSchema: AiToolOrganizationInputSchema =
  aiToolOrganizationInputSchemaDefinition;
export type AiToolOrganizationInput = z.infer<typeof aiToolOrganizationInputSchema>;

const aiToolMemberInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
export interface AiToolMemberInputSchema extends Named<typeof aiToolMemberInputSchemaDefinition> {}
export const aiToolMemberInputSchema: AiToolMemberInputSchema = aiToolMemberInputSchemaDefinition;
export type AiToolMemberInput = z.infer<typeof aiToolMemberInputSchema>;

const findAiToolEntryInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface FindAiToolEntryInputSchema extends Named<
  typeof findAiToolEntryInputSchemaDefinition
> {}
export const findAiToolEntryInputSchema: FindAiToolEntryInputSchema =
  findAiToolEntryInputSchemaDefinition;
export type FindAiToolEntryInput = z.infer<typeof findAiToolEntryInputSchema>;

const createAiToolEntryInputSchemaDefinition = z
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
export interface CreateAiToolEntryInputSchema extends Named<
  typeof createAiToolEntryInputSchemaDefinition
> {}
export const createAiToolEntryInputSchema: CreateAiToolEntryInputSchema =
  createAiToolEntryInputSchemaDefinition;
export type CreateAiToolEntryInput = z.infer<typeof createAiToolEntryInputSchema>;

const updateAiToolEntryInputSchemaDefinition = z
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
export interface UpdateAiToolEntryInputSchema extends Named<
  typeof updateAiToolEntryInputSchemaDefinition
> {}
export const updateAiToolEntryInputSchema: UpdateAiToolEntryInputSchema =
  updateAiToolEntryInputSchemaDefinition;
export type UpdateAiToolEntryInput = z.infer<typeof updateAiToolEntryInputSchema>;

const reorderAiToolEntriesInputSchemaDefinition = aiToolOrganizationInputSchema
  .safeExtend({
    updates: z.array(z.object({ id: z.string().min(1), order: z.number().int() }).strict()),
  })
  .strict();
export interface ReorderAiToolEntriesInputSchema extends Named<
  typeof reorderAiToolEntriesInputSchemaDefinition
> {}
export const reorderAiToolEntriesInputSchema: ReorderAiToolEntriesInputSchema =
  reorderAiToolEntriesInputSchemaDefinition;
export type ReorderAiToolEntriesInput = z.infer<typeof reorderAiToolEntriesInputSchema>;

const seedAiToolStarterPackInputSchemaDefinition = aiToolOrganizationInputSchema
  .safeExtend({
    actorUserId: z.string().nullable().optional(),
    slugs: z.array(z.string().min(1)).optional(),
  })
  .strict();
export interface SeedAiToolStarterPackInputSchema extends Named<
  typeof seedAiToolStarterPackInputSchemaDefinition
> {}
export const seedAiToolStarterPackInputSchema: SeedAiToolStarterPackInputSchema =
  seedAiToolStarterPackInputSchemaDefinition;
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
  tools: { slug: string; displayName: string }[];
  providers: {
    providerKey: string;
    displayName: string;
    configured: boolean;
  }[];
  configuredProviderKeys: string[];
};

/** One provider the admin drawer offers, and whether it is set up yet. */
const aiToolProviderOptionSchemaDefinition = z
  .object({
    providerKey: z.string(),
    displayName: z.string(),
    configured: z.boolean(),
  })
  .strict();
export interface AiToolProviderOptionSchema extends Named<
  typeof aiToolProviderOptionSchemaDefinition
> {}
export const aiToolProviderOptionSchema: AiToolProviderOptionSchema =
  aiToolProviderOptionSchemaDefinition;
export type AiToolProviderOption = z.infer<typeof aiToolProviderOptionSchema>;

/** Which providers this member's organization has configured. */
const aiToolProviderAvailabilitySchemaDefinition = z
  .object({ configuredProviders: z.array(z.string()) })
  .strict();
export interface AiToolProviderAvailabilitySchema extends Named<
  typeof aiToolProviderAvailabilitySchemaDefinition
> {}
export const aiToolProviderAvailabilitySchema: AiToolProviderAvailabilitySchema =
  aiToolProviderAvailabilitySchemaDefinition;

/**
 * The OTLP endpoint the Claude Code tile auto-fills, or null when no
 * `claude_code` source is published yet. Only the URL is disclosed — no
 * name, scope or secret — because the bearer token gates the write.
 */
const aiToolOtlpEndpointSchemaDefinition = z.object({ endpoint: z.string().nullable() }).strict();
export interface AiToolOtlpEndpointSchema extends Named<
  typeof aiToolOtlpEndpointSchemaDefinition
> {}
export const aiToolOtlpEndpointSchema: AiToolOtlpEndpointSchema =
  aiToolOtlpEndpointSchemaDefinition;

/** One tile of the starter pack, as the admin checklist renders it. */
const aiToolStarterTileChoiceSchemaDefinition = z
  .object({ slug: z.string(), displayName: z.string(), type: aiToolTypeSchema })
  .strict();
export interface AiToolStarterTileChoiceSchema extends Named<
  typeof aiToolStarterTileChoiceSchemaDefinition
> {}
export const aiToolStarterTileChoiceSchema: AiToolStarterTileChoiceSchema =
  aiToolStarterTileChoiceSchemaDefinition;

/** One routing policy the admin drawer offers for a model-provider tile. */
const aiToolRoutingPolicyOptionSchemaDefinition = z
  .object({ id: z.string(), name: z.string() })
  .strict();
export interface AiToolRoutingPolicyOptionSchema extends Named<
  typeof aiToolRoutingPolicyOptionSchemaDefinition
> {}
export const aiToolRoutingPolicyOptionSchema: AiToolRoutingPolicyOptionSchema =
  aiToolRoutingPolicyOptionSchemaDefinition;

/** What importing the starter pack did: per-slug, and never destructive. */
const aiToolStarterPackImportSchemaDefinition = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export interface AiToolStarterPackImportSchema extends Named<
  typeof aiToolStarterPackImportSchemaDefinition
> {}
export const aiToolStarterPackImportSchema: AiToolStarterPackImportSchema =
  aiToolStarterPackImportSchemaDefinition;

export type AiToolStarterTileChoice = z.infer<typeof aiToolStarterTileChoiceSchema>;

/** Main answered NOT_FOUND on `get` and a plain error on update and remove; each refuses here. */
export class AiToolEntryNotFoundError extends NotFoundError {
  constructor(entryId: string) {
    super("not_found", { resource: "AI tool entry", id: entryId });
    this.name = "AiToolEntryNotFoundError";
  }
}

export class AiToolDepartmentScopeError extends Error {
  constructor() {
    super("One or more departments do not belong to this organization");
    this.name = "AiToolDepartmentScopeError";
  }
}
