import { z } from "zod";

import { langyMessagePartSchema } from "./json.ts";
import { langyTurnContextSchema } from "./langy-turn-context.ts";
import { langyConversationListCursorSchema } from "./langy.dtos.ts";
import { langyEgressAllowlistSchema } from "./langy.ts";

/** One chat message on the wire - role + opaque parts (bounded downstream). */
export const langyTurnMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(langyMessagePartSchema).default([]),
});

/**
 * Per-send model override from the sidebar picker. Shape-validated here; the value is checked
 * against the project's Langy VK allowlist in the service.
 */
export const langyModelOverrideSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._:-]+)+$/,
    "modelOverride must be in 'provider/model' shape",
  )
  .max(200);

/** A caller-chosen conversation id the create path may adopt, gated at the wire. */
export const langyAdoptableConversationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{6,120}$/, "conversationId must be 6-120 characters from [A-Za-z0-9_-]");

/** The `langyEgress.get` and `langyEgress.set` answer: the allowlist plus enforcement state. */
export const langyEgressStateSchema = z
  .object({ allowlist: langyEgressAllowlistSchema, enforcing: z.boolean() })
  .strict();

/** The `langyEgress.get` input. */
export const langyEgressGetInputSchema = z.object({ projectId: z.string() });

/** The `langyEgress.set` input. */
export const langyEgressSetInputSchema = z.object({
  projectId: z.string(),
  allowlist: langyEgressAllowlistSchema,
});

const projectScope = { projectId: z.string() } as const;

export const langyProjectInputSchema = z.object(projectScope);

export const langyPanelConversationInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
});

export const langyListInputSchema = z.object({
  ...projectScope,
  limit: z.number().int().min(1).max(100).default(30),
  cursor: langyConversationListCursorSchema.optional(),
  query: z.string().trim().max(200).optional(),
});

export const langyEventsAfterInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  after: z.object({ acceptedAt: z.number().int().nonnegative(), eventId: z.string() }),
});

export const langyRenameInputSchema = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

export const langyForkInputSchema = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
});

/** Inputs shared by create + continue (the SAME turn-start operation). */
const turnShape = {
  ...projectScope,
  /** Client-minted identity for one logical send; reusing a key with other content is a 409. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** @deprecated wire alias for pre-rename client bundles - same semantics. */
  requestId: z.string().uuid().optional(),
  messages: z.array(langyTurnMessageSchema).min(1),
  modelOverride: langyModelOverrideSchema.optional(),
  /** `regenerate-message` re-drives the last turn against the message already on record. */
  trigger: z.enum(["submit-message", "regenerate-message", "resume-stream"]).optional(),
  ...langyTurnContextSchema.shape,
} as const;

/** `createConversation`: the conversation a panel-open warm booted is adopted when named. */
export const langyPanelCreateConversationInputSchema = z.object({
  ...turnShape,
  conversationId: langyAdoptableConversationIdSchema.optional(),
});

export const langyContinueConversationInputSchema = z.object({
  ...turnShape,
  conversationId: z.string().min(1),
});

export const langyStopTurnPanelInputSchema = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
});

export const langyClaimUiActionInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  actionId: z.string(),
});

export const langyCompleteUiActionInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  actionId: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorCode: z.string().max(200).optional(),
});

export const langyAnswerLocalPermissionInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  waitId: z.string(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]),
});

export const langyAnswerQuestionInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  waitId: z.string(),
  answers: z
    .array(
      z.object({
        question: z.string(),
        selected: z.array(z.string()),
        other: z.string().max(4000).optional(),
      }),
    )
    .min(1)
    .max(4),
});

export const langySetLocalPolicyInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  skipPermissions: z.boolean(),
});

export const langySetCodeAccessPreferenceInputSchema = z.object({
  ...projectScope,
  preference: z.enum(["github"]).nullable(),
});

export const langyWarmWorkerInputSchema = z.object({
  ...projectScope,
  conversationId: langyAdoptableConversationIdSchema.optional(),
  modelOverride: langyModelOverrideSchema.optional(),
});

export const langyRecordFeedbackInputSchema = z.object({
  ...projectScope,
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  /** Trace id of the conversation turn, for LangWatch feedback events. */
  traceId: z.string().optional(),
  rating: z.enum(["up", "down"]),
  sentiment: z.enum(["frustrated", "delighted", "neutral"]).optional(),
  comment: z.string().max(2000).optional(),
  shareConversationConsent: z.boolean().optional(),
});

export const langyFeedbackPromptShownInputSchema = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
});

export const langyTurnStreamInputSchema = z.object({
  ...projectScope,
  conversationId: z.string(),
  turnId: z.string(),
});

export const langyLocalAnsweredSchema = z.object({ answered: z.literal(true) });
export const langyLocalPolicySchema = z.object({ skipPermissions: z.boolean() });
export const langyLocalDisconnectedSchema = z.object({ disconnected: z.boolean() });
export const langyControlRequestRenewedSchema = z.object({ expiresAt: z.string() });

/** The signed-in person behind a panel call; the session a turn's credentials are minted for. */
export type LangyPanelCaller = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
}>;

/** One panel operation's parsed wire input, with the person the browser session proved. */
export type LangyPanelCall<Schema extends z.ZodType> = z.output<Schema> &
  Readonly<{ caller: LangyPanelCaller }>;
