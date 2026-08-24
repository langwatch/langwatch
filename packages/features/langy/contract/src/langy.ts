import { HandledError } from "@langwatch/handled-error";
import { z } from "zod/v4";

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

export const langyEgressAllowlistSchema = z.array(langyEgressHostSchema);
export type LangyEgressAllowlist = z.infer<typeof langyEgressAllowlistSchema>;
export const langyEgressProjectInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type LangyEgressProjectInput = z.infer<typeof langyEgressProjectInputSchema>;
export const langySetEgressInputSchema = langyEgressProjectInputSchema
  .extend({ allowlist: langyEgressAllowlistSchema })
  .strict();
export type LangySetEgressInput = z.infer<typeof langySetEgressInputSchema>;
export const langyConversationMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);

export const langyMessageSchema = z.object({
  id: langyMessageIdSchema,
  conversationId: langyConversationIdSchema,
  role: langyConversationMessageRoleSchema,
  parts: z.array(z.unknown()),
  createdAt: z.number().int().nonnegative(),
}).strict();
export type LangyMessage = z.infer<typeof langyMessageSchema>;

export const langyConversationSchema = z.object({
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
}).strict();
export type LangyConversation = z.infer<typeof langyConversationSchema>;

export const langyCreateConversationInputSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: langyConversationIdSchema.optional(),
}).strict();
export type LangyCreateConversationInput = z.infer<typeof langyCreateConversationInputSchema>;

export const langyConversationListInputSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(50),
  cursor: z.string().max(500).optional(),
  query: z.string().max(200).optional(),
}).strict();
export type LangyConversationListInput = z.input<typeof langyConversationListInputSchema>;
export const langyConversationInputSchema = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    conversationId: langyConversationIdSchema,
  })
  .strict();
export type LangyConversationInput = z.infer<typeof langyConversationInputSchema>;

export const langyTurnInputSchema = langyConversationInputSchema.extend({
  turnId: langyTurnIdSchema,
  idempotencyKey: z.string().min(1).max(256),
  messages: z.array(z.unknown()).min(1),
  model: z.string().min(1).optional(),
}).strict();
export type LangyTurnInput = z.infer<typeof langyTurnInputSchema>;
export const langyMessageInputSchema = langyConversationInputSchema
  .extend({ messageId: langyMessageIdSchema })
  .strict();
export type LangyMessageInput = z.infer<typeof langyMessageInputSchema>;

export const langyStopTurnInputSchema = langyConversationInputSchema
  .extend({ turnId: langyTurnIdSchema })
  .strict();
export type LangyStopTurnInput = z.infer<typeof langyStopTurnInputSchema>;

export const langyCredentialInputSchema = z
  .object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    scope: langyCredentialScopeSchema,
    conversationId: langyConversationIdSchema.optional(),
    turnId: langyTurnIdSchema.optional(),
  })
  .strict();
export type LangyCredentialInput = z.infer<typeof langyCredentialInputSchema>;
export const langyRelayFrameSchema = z
  .object({
    conversationId: langyConversationIdSchema,
    turnId: langyTurnIdSchema,
    type: z.string().min(1),
    payload: z.unknown(),
    sequence: z.number().int().nonnegative().optional(),
  })
  .strict();
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

export type LangyMirrorTier = "content" | "structural" | "skip";

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
export type LangyWorkerCredentials = {
  langwatchApiKey?: string;
  langwatchApiKeyId?: string;
  llmVirtualKey: string;
  langwatchEndpoint: string;
  gatewayBaseUrl: string;
  organizationId: string;
  githubToken?: string;
  githubLogin?: string;
  githubRepoScopeKey?: string;
  egressAllowlist?: LangyEgressAllowlist;
  mirrorTier?: LangyMirrorTier;
  harness?: "opencode" | "pi";
};
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
