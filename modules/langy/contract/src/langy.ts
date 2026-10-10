import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const LANGY_FEATURE_ID = "langy" as const;

export const langyConversationIdSchema = z.string().min(1).max(120);
export const langyTurnIdSchema = z.string().min(1).max(160);
export const langyMessageIdSchema = z.string().min(1).max(160);
export const langyCredentialScopeSchema = z.enum(["conversation", "turn"]);
export const langyEgressHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(\*\.)?([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.?$/u);

const langyEgressAllowlistSchemaDefinition = z.array(langyEgressHostSchema);
export interface LangyEgressAllowlistSchema extends Named<
  typeof langyEgressAllowlistSchemaDefinition
> {}
export const langyEgressAllowlistSchema: LangyEgressAllowlistSchema =
  langyEgressAllowlistSchemaDefinition;
export type LangyEgressAllowlist = z.infer<typeof langyEgressAllowlistSchema>;
const langyEgressProjectInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface LangyEgressProjectInputSchema extends Named<
  typeof langyEgressProjectInputSchemaDefinition
> {}
export const langyEgressProjectInputSchema: LangyEgressProjectInputSchema =
  langyEgressProjectInputSchemaDefinition;
export type LangyEgressProjectInput = z.infer<typeof langyEgressProjectInputSchema>;
const langySetEgressInputSchemaDefinition = langyEgressProjectInputSchema
  .safeExtend({ allowlist: langyEgressAllowlistSchema })
  .strict();
export interface LangySetEgressInputSchema extends Named<
  typeof langySetEgressInputSchemaDefinition
> {}
export const langySetEgressInputSchema: LangySetEgressInputSchema =
  langySetEgressInputSchemaDefinition;
export type LangySetEgressInput = z.infer<typeof langySetEgressInputSchema>;
export const langyConversationMessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

const langyMessageSchemaDefinition = z
  .object({
    id: langyMessageIdSchema,
    conversationId: langyConversationIdSchema,
    role: langyConversationMessageRoleSchema,
    parts: z.array(z.unknown()),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export interface LangyMessageSchema extends Named<typeof langyMessageSchemaDefinition> {}
export const langyMessageSchema: LangyMessageSchema = langyMessageSchemaDefinition;
export type LangyMessage = z.infer<typeof langyMessageSchema>;

const langyConversationSchemaDefinition = z
  .object({
    id: langyConversationIdSchema,
    projectId: z.string().min(1),
    userId: z.string().min(1),
    title: z.string().nullable(),
    isShared: z.boolean(),
    status: z.string(),
    currentTurnId: langyTurnIdSchema.nullable(),
    lastError: z.string().nullable(),
    lastModel: z.string().nullable(),
    messageCount: z.number().int().nonnegative(),
    lastActivityAt: z.number().int().nonnegative(),
  })
  .strict();
export interface LangyConversationSchema extends Named<typeof langyConversationSchemaDefinition> {}
export const langyConversationSchema: LangyConversationSchema = langyConversationSchemaDefinition;
export type LangyConversation = z.infer<typeof langyConversationSchema>;

const langyCreateConversationInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    conversationId: langyConversationIdSchema.optional(),
  })
  .strict();
export interface LangyCreateConversationInputSchema extends Named<
  typeof langyCreateConversationInputSchemaDefinition
> {}
export const langyCreateConversationInputSchema: LangyCreateConversationInputSchema =
  langyCreateConversationInputSchemaDefinition;
export type LangyCreateConversationInput = z.infer<typeof langyCreateConversationInputSchema>;

const langyConversationListInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    limit: z.number().int().positive().max(100).default(50),
    cursor: z.string().max(500).optional(),
    query: z.string().max(200).optional(),
  })
  .strict();
export interface LangyConversationListInputSchema extends Named<
  typeof langyConversationListInputSchemaDefinition
> {}
export const langyConversationListInputSchema: LangyConversationListInputSchema =
  langyConversationListInputSchemaDefinition;
export type LangyConversationListInput = z.input<typeof langyConversationListInputSchema>;
const langyConversationInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    conversationId: langyConversationIdSchema,
  })
  .strict();
export interface LangyConversationInputSchema extends Named<
  typeof langyConversationInputSchemaDefinition
> {}
export const langyConversationInputSchema: LangyConversationInputSchema =
  langyConversationInputSchemaDefinition;
export type LangyConversationInput = z.infer<typeof langyConversationInputSchema>;

const langyTurnInputSchemaDefinition = langyConversationInputSchema
  .safeExtend({
    turnId: langyTurnIdSchema,
    idempotencyKey: z.string().min(1).max(256),
    messages: z.array(z.unknown()).min(1),
    model: z.string().min(1).optional(),
  })
  .strict();
export interface LangyTurnInputSchema extends Named<typeof langyTurnInputSchemaDefinition> {}
export const langyTurnInputSchema: LangyTurnInputSchema = langyTurnInputSchemaDefinition;
export type LangyTurnInput = z.infer<typeof langyTurnInputSchema>;
const langyMessageInputSchemaDefinition = langyConversationInputSchema
  .safeExtend({ messageId: langyMessageIdSchema })
  .strict();
export interface LangyMessageInputSchema extends Named<typeof langyMessageInputSchemaDefinition> {}
export const langyMessageInputSchema: LangyMessageInputSchema = langyMessageInputSchemaDefinition;
export type LangyMessageInput = z.infer<typeof langyMessageInputSchema>;

const langyStopTurnInputSchemaDefinition = langyConversationInputSchema
  .safeExtend({ turnId: langyTurnIdSchema })
  .strict();
export interface LangyStopTurnInputSchema extends Named<
  typeof langyStopTurnInputSchemaDefinition
> {}
export const langyStopTurnInputSchema: LangyStopTurnInputSchema =
  langyStopTurnInputSchemaDefinition;
export type LangyStopTurnInput = z.infer<typeof langyStopTurnInputSchema>;

const langyCredentialInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    scope: langyCredentialScopeSchema,
    conversationId: langyConversationIdSchema.optional(),
    turnId: langyTurnIdSchema.optional(),
  })
  .strict();
export interface LangyCredentialInputSchema extends Named<
  typeof langyCredentialInputSchemaDefinition
> {}
export const langyCredentialInputSchema: LangyCredentialInputSchema =
  langyCredentialInputSchemaDefinition;
export type LangyCredentialInput = z.infer<typeof langyCredentialInputSchema>;
const langyRelayFrameSchemaDefinition = z
  .object({
    conversationId: langyConversationIdSchema,
    turnId: langyTurnIdSchema,
    type: z.string().min(1),
    payload: z.unknown(),
    sequence: z.number().int().nonnegative().optional(),
  })
  .strict();
export interface LangyRelayFrameSchema extends Named<typeof langyRelayFrameSchemaDefinition> {}
export const langyRelayFrameSchema: LangyRelayFrameSchema = langyRelayFrameSchemaDefinition;
export type LangyRelayFrame = z.infer<typeof langyRelayFrameSchema>;

export type LangyCredential = {
  token: string;
  expiresAt: number;
  scope: z.infer<typeof langyCredentialScopeSchema>;
  id?: string;
};
export type LangyCredentialSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
};

export const langyMirrorTierSchema = z.enum(["content", "structural", "skip"]);
export type LangyMirrorTier = z.infer<typeof langyMirrorTierSchema>;

/** Extracts the user-visible text carried by portable message parts. */
export const extractLangyTextFromParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
};

/** Credentials injected into a Langy worker for one turn. */
const langyWorkerCredentialsSchemaDefinition = z
  .object({
    langwatchApiKey: z.string().min(1).optional(),
    langwatchApiKeyId: z.string().min(1).optional(),
    llmVirtualKey: z.string().min(1),
    langwatchEndpoint: z.string().min(1),
    gatewayBaseUrl: z.string().min(1),
    organizationId: z.string().min(1),
    githubToken: z.string().min(1).optional(),
    githubLogin: z.string().min(1).optional(),
    githubRepoScopeKey: z.string().min(1).optional(),
    egressAllowlist: langyEgressAllowlistSchema.optional(),
    mirrorTier: langyMirrorTierSchema.optional(),
    harness: z.enum(["opencode", "pi"]).optional(),
    disabledSkillIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export interface LangyWorkerCredentialsSchema extends Named<
  typeof langyWorkerCredentialsSchemaDefinition
> {}
export const langyWorkerCredentialsSchema: LangyWorkerCredentialsSchema =
  langyWorkerCredentialsSchemaDefinition;
export type LangyWorkerCredentials = z.infer<typeof langyWorkerCredentialsSchema>;
export type LangyCredentials = LangyWorkerCredentials;
export type LangyConversationPage = {
  items: LangyConversation[];
  nextCursor: string | null;
};

export class LangyCredentialResolutionError extends HandledError {
  constructor(message: string) {
    super("langy_credential_resolution", message, { httpStatus: 409 });
    this.name = "LangyCredentialResolutionError";
  }
}
