/**
 * The HTTP shapes of local control (ADR-129), shared by the CLI, the worker,
 * and the panel (tRPC). Browser-safe: zod and nothing else. See the route
 * declarations under `process/src/transport` for the full path list.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  bashOutputSchema,
  localCallErrorSchema,
  localToolCallSchema,
  workspaceInfoSchema,
} from "./langy.local-control-protocol.ts";

/** A control request as the CLI lists it. */
const controlRequestSchemaDefinition = z.object({
  id: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  conversationUrl: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export interface ControlRequestSchema extends Named<typeof controlRequestSchemaDefinition> {}
export const controlRequestSchema: ControlRequestSchema = controlRequestSchemaDefinition;
export type ControlRequest = z.infer<typeof controlRequestSchema>;

const listControlRequestsResponseSchemaDefinition = z.object({
  requests: z.array(controlRequestSchema),
});
export interface ListControlRequestsResponseSchema extends Named<
  typeof listControlRequestsResponseSchemaDefinition
> {}
export const listControlRequestsResponseSchema: ListControlRequestsResponseSchema =
  listControlRequestsResponseSchemaDefinition;

/** A bodiless control action: an absent body reads as this empty object (§8). */
const controlActionBodySchemaDefinition = z.object({});
export interface ControlActionBodySchema extends Named<typeof controlActionBodySchemaDefinition> {}
export const controlActionBodySchema: ControlActionBodySchema = controlActionBodySchemaDefinition;

export type ListControlRequestsResponse = z.infer<typeof listControlRequestsResponseSchema>;

const approveControlRequestBodySchemaDefinition = z.object({
  workspace: workspaceInfoSchema,
});
export interface ApproveControlRequestBodySchema extends Named<
  typeof approveControlRequestBodySchemaDefinition
> {}
export const approveControlRequestBodySchema: ApproveControlRequestBodySchema =
  approveControlRequestBodySchemaDefinition;

const approveControlRequestResponseSchemaDefinition = z.object({
  /** The Langy session key the CLI connects with; never shown again. */
  sessionKey: z.string(),
  endpoint: z.string(),
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  }),
});
export interface ApproveControlRequestResponseSchema extends Named<
  typeof approveControlRequestResponseSchemaDefinition
> {}
export const approveControlRequestResponseSchema: ApproveControlRequestResponseSchema =
  approveControlRequestResponseSchemaDefinition;
export type ApproveControlRequestResponse = z.infer<typeof approveControlRequestResponseSchema>;

/** What the worker's code_access tool reads before it decides to ask. */
const workspaceStatusSchemaDefinition = z.object({
  connected: z.boolean(),
  workspace: workspaceInfoSchema.optional(),
  /** The user's remembered choice, when there is one. */
  codeAccessPreference: z.enum(["github"]).nullable(),
  github: z.object({
    installed: z.boolean(),
    accountLogin: z.string().optional(),
  }),
  /** An open request not yet approved, so the card can show it. */
  pendingRequest: controlRequestSchema.optional(),
});
export interface WorkspaceStatusSchema extends Named<typeof workspaceStatusSchemaDefinition> {}
export const workspaceStatusSchema: WorkspaceStatusSchema = workspaceStatusSchemaDefinition;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

const createControlRequestResponseSchemaDefinition = z.object({
  request: controlRequestSchema,
  /** The one command the card shows. */
  command: z.string(),
});
export interface CreateControlRequestResponseSchema extends Named<
  typeof createControlRequestResponseSchemaDefinition
> {}
export const createControlRequestResponseSchema: CreateControlRequestResponseSchema =
  createControlRequestResponseSchemaDefinition;

export type CreateControlRequestResponse = z.infer<typeof createControlRequestResponseSchema>;

export const startCallBodySchema = localToolCallSchema;

const startCallResponseSchemaDefinition = z.object({
  callId: z.string(),
});
export interface StartCallResponseSchema extends Named<typeof startCallResponseSchemaDefinition> {}
export const startCallResponseSchema: StartCallResponseSchema = startCallResponseSchemaDefinition;
export type StartCallResponse = z.infer<typeof startCallResponseSchema>;

const cancelCallResponseSchemaDefinition = z.object({
  callId: z.string(),
  cancelled: z.literal(true),
});
export interface CancelCallResponseSchema extends Named<
  typeof cancelCallResponseSchemaDefinition
> {}
export const cancelCallResponseSchema: CancelCallResponseSchema =
  cancelCallResponseSchemaDefinition;
export type LangyLocalCallCancelled = z.infer<typeof cancelCallResponseSchema>;

export const CALL_STATES = ["pending", "running", "awaiting_permission", "done"] as const;
export type CallState = (typeof CALL_STATES)[number];

/** One long-poll answer. `done` carries the result; the rest say wait more. */
const pollCallResponseSchemaDefinition = z.object({
  callId: z.string(),
  state: z.enum(CALL_STATES),
  ok: z.boolean().optional(),
  text: z.string().optional(),
  output: bashOutputSchema.optional(),
  error: localCallErrorSchema.optional(),
});
export interface PollCallResponseSchema extends Named<typeof pollCallResponseSchemaDefinition> {}
export const pollCallResponseSchema: PollCallResponseSchema = pollCallResponseSchemaDefinition;
export type PollCallResponse = z.infer<typeof pollCallResponseSchema>;

/** The worker's question tool, the same shape the panel bridge already maps. */
const questionOptionSchemaDefinition = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  /** Rendered as a quiet link under the bordered options; still an answer. */
  quiet: z.boolean().optional(),
});
export interface QuestionOptionSchema extends Named<typeof questionOptionSchemaDefinition> {}
export const questionOptionSchema: QuestionOptionSchema = questionOptionSchemaDefinition;

const questionSchemaDefinition = z.object({
  question: z.string().min(1).max(2000),
  header: z.string().max(60).optional(),
  options: z.array(questionOptionSchema).min(1).max(8),
  multiple: z.boolean().optional(),
  /** Offer a free-text answer next to the options. */
  allowOther: z.boolean().optional(),
  /** Draw the question as reply prose above the options, not as a title. */
  bare: z.boolean().optional(),
});
export interface QuestionSchema extends Named<typeof questionSchemaDefinition> {}
export const questionSchema: QuestionSchema = questionSchemaDefinition;

const startWaitBodySchemaDefinition = z.object({
  kind: z.literal("question"),
  questions: z.array(questionSchema).min(1).max(4),
});
export interface StartWaitBodySchema extends Named<typeof startWaitBodySchemaDefinition> {}
export const startWaitBodySchema: StartWaitBodySchema = startWaitBodySchemaDefinition;

const startWaitResponseSchemaDefinition = z.object({
  waitId: z.string(),
});
export interface StartWaitResponseSchema extends Named<typeof startWaitResponseSchemaDefinition> {}
export const startWaitResponseSchema: StartWaitResponseSchema = startWaitResponseSchemaDefinition;
export type StartWaitResponse = z.infer<typeof startWaitResponseSchema>;

export const WAIT_STATES = ["pending", "answered", "expired", "cancelled"] as const;

/** The user's answer to one question: the labels picked, or their own words. */
const questionAnswerSchemaDefinition = z.object({
  question: z.string(),
  selected: z.array(z.string()),
  other: z.string().optional(),
});
export interface QuestionAnswerSchema extends Named<typeof questionAnswerSchemaDefinition> {}
export const questionAnswerSchema: QuestionAnswerSchema = questionAnswerSchemaDefinition;

const pollWaitResponseSchemaDefinition = z.object({
  waitId: z.string(),
  state: z.enum(WAIT_STATES),
  answers: z.array(questionAnswerSchema).optional(),
});
export interface PollWaitResponseSchema extends Named<typeof pollWaitResponseSchemaDefinition> {}
export const pollWaitResponseSchema: PollWaitResponseSchema = pollWaitResponseSchemaDefinition;
export type PollWaitResponse = z.infer<typeof pollWaitResponseSchema>;

/** The cards one conversation raised, as `langy.localRecord` answers them. */
const langyLocalRecordSchemaDefinition = z.object({
  waits: z.array(z.looseObject({ turnId: z.string(), toolCallId: z.string() })),
  workspaceConnected: z.boolean(),
});
export interface LangyLocalRecordSchema extends Named<typeof langyLocalRecordSchemaDefinition> {}
export const langyLocalRecordSchema: LangyLocalRecordSchema = langyLocalRecordSchemaDefinition;

/** What became of a conversation's latest request to share a folder. */
export const langyControlRequestStateSchema = z.enum([
  "open",
  "approved",
  "expired",
  "declined",
  "ended",
  "none",
]);
export type LangyControlRequestState = z.infer<typeof langyControlRequestStateSchema>;

/** What the panel chip and the code access card read. */
const langyLocalWorkspaceStatusSchemaDefinition = z.object({
  connected: z.boolean(),
  workspace: z.looseObject({}).nullable(),
  skipAllowed: z.boolean(),
  skipPermissions: z.boolean(),
  pendingRequest: z.looseObject({}).nullable(),
  requestState: langyControlRequestStateSchema,
  codeAccessPreference: z.literal("github").nullable(),
});
export interface LangyLocalWorkspaceStatusSchema extends Named<
  typeof langyLocalWorkspaceStatusSchemaDefinition
> {}
export const langyLocalWorkspaceStatusSchema: LangyLocalWorkspaceStatusSchema =
  langyLocalWorkspaceStatusSchemaDefinition;

/** The remembered choice on its own, for the settings page. */
const langyCodeAccessPreferenceSchemaDefinition = z.object({
  preference: z.literal("github").nullable(),
});
export interface LangyCodeAccessPreferenceSchema extends Named<
  typeof langyCodeAccessPreferenceSchemaDefinition
> {}
export const langyCodeAccessPreferenceSchema: LangyCodeAccessPreferenceSchema =
  langyCodeAccessPreferenceSchemaDefinition;
