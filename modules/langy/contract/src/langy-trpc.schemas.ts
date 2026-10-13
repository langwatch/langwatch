import type { Named } from "@langwatch/module";
import { z } from "zod";

import { langyMessagePartSchema } from "./json.ts";
import { langyTurnContextSchema } from "./langy-turn-context.ts";
import { langyConversationListCursorSchema } from "./langy.dtos.ts";
import { langyEgressAllowlistSchema } from "./langy.ts";

/** One chat message on the wire - role + opaque parts (bounded downstream). */
const langyTurnMessageSchemaDefinition = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(langyMessagePartSchema).default([]),
});
export interface LangyTurnMessageSchema extends Named<typeof langyTurnMessageSchemaDefinition> {}
export const langyTurnMessageSchema: LangyTurnMessageSchema = langyTurnMessageSchemaDefinition;

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
const langyEgressStateSchemaDefinition = z
  .object({ allowlist: langyEgressAllowlistSchema, enforcing: z.boolean() })
  .strict();
export interface LangyEgressStateSchema extends Named<typeof langyEgressStateSchemaDefinition> {}
export const langyEgressStateSchema: LangyEgressStateSchema = langyEgressStateSchemaDefinition;

/** The `langyEgress.get` input. */
const langyEgressGetInputSchemaDefinition = z.object({ projectId: z.string() });
export interface LangyEgressGetInputSchema extends Named<
  typeof langyEgressGetInputSchemaDefinition
> {}
export const langyEgressGetInputSchema: LangyEgressGetInputSchema =
  langyEgressGetInputSchemaDefinition;

/** The `langyEgress.set` input. */
const langyEgressSetInputSchemaDefinition = z.object({
  projectId: z.string(),
  allowlist: langyEgressAllowlistSchema,
});
export interface LangyEgressSetInputSchema extends Named<
  typeof langyEgressSetInputSchemaDefinition
> {}
export const langyEgressSetInputSchema: LangyEgressSetInputSchema =
  langyEgressSetInputSchemaDefinition;

const projectScope = { projectId: z.string() } as const;

const langyProjectInputSchemaDefinition = z.object(projectScope);
export interface LangyProjectInputSchema extends Named<typeof langyProjectInputSchemaDefinition> {}
export const langyProjectInputSchema: LangyProjectInputSchema = langyProjectInputSchemaDefinition;

const langyPanelConversationInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
});
export interface LangyPanelConversationInputSchema extends Named<
  typeof langyPanelConversationInputSchemaDefinition
> {}
export const langyPanelConversationInputSchema: LangyPanelConversationInputSchema =
  langyPanelConversationInputSchemaDefinition;

const langyListInputSchemaDefinition = z.object({
  ...projectScope,
  limit: z.number().int().min(1).max(100).default(30),
  cursor: langyConversationListCursorSchema.optional(),
  query: z.string().trim().max(200).optional(),
});
export interface LangyListInputSchema extends Named<typeof langyListInputSchemaDefinition> {}
export const langyListInputSchema: LangyListInputSchema = langyListInputSchemaDefinition;

const langyEventsAfterInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  after: z.object({ acceptedAt: z.number().int().nonnegative(), eventId: z.string() }),
});
export interface LangyEventsAfterInputSchema extends Named<
  typeof langyEventsAfterInputSchemaDefinition
> {}
export const langyEventsAfterInputSchema: LangyEventsAfterInputSchema =
  langyEventsAfterInputSchemaDefinition;

const langyRenameInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});
export interface LangyRenameInputSchema extends Named<typeof langyRenameInputSchemaDefinition> {}
export const langyRenameInputSchema: LangyRenameInputSchema = langyRenameInputSchemaDefinition;

const langyForkInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
});
export interface LangyForkInputSchema extends Named<typeof langyForkInputSchemaDefinition> {}
export const langyForkInputSchema: LangyForkInputSchema = langyForkInputSchemaDefinition;

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
const langyPanelCreateConversationInputSchemaDefinition = z.object({
  ...turnShape,
  conversationId: langyAdoptableConversationIdSchema.optional(),
});
export interface LangyPanelCreateConversationInputSchema extends Named<
  typeof langyPanelCreateConversationInputSchemaDefinition
> {}
export const langyPanelCreateConversationInputSchema: LangyPanelCreateConversationInputSchema =
  langyPanelCreateConversationInputSchemaDefinition;

const langyContinueConversationInputSchemaDefinition = z.object({
  ...turnShape,
  conversationId: z.string().min(1),
});
export interface LangyContinueConversationInputSchema extends Named<
  typeof langyContinueConversationInputSchemaDefinition
> {}
export const langyContinueConversationInputSchema: LangyContinueConversationInputSchema =
  langyContinueConversationInputSchemaDefinition;

const langyStopTurnPanelInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
});
export interface LangyStopTurnPanelInputSchema extends Named<
  typeof langyStopTurnPanelInputSchemaDefinition
> {}
export const langyStopTurnPanelInputSchema: LangyStopTurnPanelInputSchema =
  langyStopTurnPanelInputSchemaDefinition;

const langyClaimUiActionInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  actionId: z.string(),
});
export interface LangyClaimUiActionInputSchema extends Named<
  typeof langyClaimUiActionInputSchemaDefinition
> {}
export const langyClaimUiActionInputSchema: LangyClaimUiActionInputSchema =
  langyClaimUiActionInputSchemaDefinition;

const langyCompleteUiActionInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  actionId: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorCode: z.string().max(200).optional(),
});
export interface LangyCompleteUiActionInputSchema extends Named<
  typeof langyCompleteUiActionInputSchemaDefinition
> {}
export const langyCompleteUiActionInputSchema: LangyCompleteUiActionInputSchema =
  langyCompleteUiActionInputSchemaDefinition;

const langyAnswerLocalPermissionInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  waitId: z.string(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]),
});
export interface LangyAnswerLocalPermissionInputSchema extends Named<
  typeof langyAnswerLocalPermissionInputSchemaDefinition
> {}
export const langyAnswerLocalPermissionInputSchema: LangyAnswerLocalPermissionInputSchema =
  langyAnswerLocalPermissionInputSchemaDefinition;

const langyAnswerQuestionInputSchemaDefinition = z.object({
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
export interface LangyAnswerQuestionInputSchema extends Named<
  typeof langyAnswerQuestionInputSchemaDefinition
> {}
export const langyAnswerQuestionInputSchema: LangyAnswerQuestionInputSchema =
  langyAnswerQuestionInputSchemaDefinition;

const langySetLocalPolicyInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  skipPermissions: z.boolean(),
});
export interface LangySetLocalPolicyInputSchema extends Named<
  typeof langySetLocalPolicyInputSchemaDefinition
> {}
export const langySetLocalPolicyInputSchema: LangySetLocalPolicyInputSchema =
  langySetLocalPolicyInputSchemaDefinition;

const langySetCodeAccessPreferenceInputSchemaDefinition = z.object({
  ...projectScope,
  preference: z.enum(["github"]).nullable(),
});
export interface LangySetCodeAccessPreferenceInputSchema extends Named<
  typeof langySetCodeAccessPreferenceInputSchemaDefinition
> {}
export const langySetCodeAccessPreferenceInputSchema: LangySetCodeAccessPreferenceInputSchema =
  langySetCodeAccessPreferenceInputSchemaDefinition;

const langyWarmWorkerInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: langyAdoptableConversationIdSchema.optional(),
  modelOverride: langyModelOverrideSchema.optional(),
});
export interface LangyWarmWorkerInputSchema extends Named<
  typeof langyWarmWorkerInputSchemaDefinition
> {}
export const langyWarmWorkerInputSchema: LangyWarmWorkerInputSchema =
  langyWarmWorkerInputSchemaDefinition;

const langyRecordFeedbackInputSchemaDefinition = z.object({
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
export interface LangyRecordFeedbackInputSchema extends Named<
  typeof langyRecordFeedbackInputSchemaDefinition
> {}
export const langyRecordFeedbackInputSchema: LangyRecordFeedbackInputSchema =
  langyRecordFeedbackInputSchemaDefinition;

const langyFeedbackPromptShownInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string().min(1),
});
export interface LangyFeedbackPromptShownInputSchema extends Named<
  typeof langyFeedbackPromptShownInputSchemaDefinition
> {}
export const langyFeedbackPromptShownInputSchema: LangyFeedbackPromptShownInputSchema =
  langyFeedbackPromptShownInputSchemaDefinition;

const langyTurnStreamInputSchemaDefinition = z.object({
  ...projectScope,
  conversationId: z.string(),
  turnId: z.string(),
});
export interface LangyTurnStreamInputSchema extends Named<
  typeof langyTurnStreamInputSchemaDefinition
> {}
export const langyTurnStreamInputSchema: LangyTurnStreamInputSchema =
  langyTurnStreamInputSchemaDefinition;

const langyLocalAnsweredSchemaDefinition = z.object({ answered: z.literal(true) });
export interface LangyLocalAnsweredSchema extends Named<
  typeof langyLocalAnsweredSchemaDefinition
> {}
export const langyLocalAnsweredSchema: LangyLocalAnsweredSchema =
  langyLocalAnsweredSchemaDefinition;
const langyLocalPolicySchemaDefinition = z.object({ skipPermissions: z.boolean() });
export interface LangyLocalPolicySchema extends Named<typeof langyLocalPolicySchemaDefinition> {}
export const langyLocalPolicySchema: LangyLocalPolicySchema = langyLocalPolicySchemaDefinition;
const langyLocalDisconnectedSchemaDefinition = z.object({ disconnected: z.boolean() });
export interface LangyLocalDisconnectedSchema extends Named<
  typeof langyLocalDisconnectedSchemaDefinition
> {}
export const langyLocalDisconnectedSchema: LangyLocalDisconnectedSchema =
  langyLocalDisconnectedSchemaDefinition;
const langyControlRequestRenewedSchemaDefinition = z.object({ expiresAt: z.string() });
export interface LangyControlRequestRenewedSchema extends Named<
  typeof langyControlRequestRenewedSchemaDefinition
> {}
export const langyControlRequestRenewedSchema: LangyControlRequestRenewedSchema =
  langyControlRequestRenewedSchemaDefinition;

/** The signed-in person behind a panel call; the session a turn's credentials are minted for. */
export type LangyPanelCaller = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
}>;

/** One panel operation's parsed wire input, with the person the browser session proved. */
export type LangyPanelCall<Schema extends z.ZodType> = z.output<Schema> &
  Readonly<{ caller: LangyPanelCaller }>;
