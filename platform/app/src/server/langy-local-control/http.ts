/**
 * The HTTP shapes of local control (ADR-129), shared by the three callers:
 * the CLI on the device session, the worker on its session key, and the
 * panel through tRPC. Browser-safe: zod and nothing else.
 *
 * Routes:
 *   CLI, device session or API key with scenarios:manage on the project:
 *     GET  /api/v1/langy/control/requests                open requests of the caller
 *     POST /api/v1/langy/control/requests/:id/approve    mints the session key
 *     POST /api/v1/langy/control/requests/:id/cancel
 *     GET  /api/v1/langy/control/connect                 WebSocket upgrade, session key
 *     POST /api/v1/langy/control/connect/register        long-poll fallback, session key
 *     GET  /api/v1/langy/control/connect/poll
 *     POST /api/v1/langy/control/connect/frames
 *   Worker, session key of the conversation:
 *     GET  /api/langy/local/workspace                     what code_access reads
 *     POST /api/langy/local/requests                      records the control request
 *     POST /api/langy/local/calls                         starts one local tool call
 *     GET  /api/langy/local/calls/:id                     long-polls the call
 *     POST /api/langy/local/calls/:id/cancel
 *     POST /api/langy/waits                               starts a question wait
 *     GET  /api/langy/waits/:id                           long-polls the wait
 */

import { z } from "zod";
import {
  bashOutputSchema,
  localCallErrorSchema,
  localToolCallSchema,
  workspaceInfoSchema,
} from "./protocol";

/** A control request as the CLI lists it. */
export const controlRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  conversationUrl: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ControlRequest = z.infer<typeof controlRequestSchema>;

export const listControlRequestsResponseSchema = z.object({
  requests: z.array(controlRequestSchema),
});

export const approveControlRequestBodySchema = z.object({
  workspace: workspaceInfoSchema,
});

export const approveControlRequestResponseSchema = z.object({
  /** The Langy session key the CLI connects with; never shown again. */
  sessionKey: z.string(),
  endpoint: z.string(),
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  }),
});
export type ApproveControlRequestResponse = z.infer<
  typeof approveControlRequestResponseSchema
>;

/** What the worker's code_access tool reads before it decides to ask. */
export const workspaceStatusSchema = z.object({
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
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const createControlRequestResponseSchema = z.object({
  request: controlRequestSchema,
  /** The one command the card shows. */
  command: z.string(),
});

export const startCallBodySchema = localToolCallSchema;

export const startCallResponseSchema = z.object({
  callId: z.string(),
});

export const CALL_STATES = [
  "pending",
  "running",
  "awaiting_permission",
  "done",
] as const;
export type CallState = (typeof CALL_STATES)[number];

/** One long-poll answer. `done` carries the result; the rest say wait more. */
export const pollCallResponseSchema = z.object({
  callId: z.string(),
  state: z.enum(CALL_STATES),
  ok: z.boolean().optional(),
  text: z.string().optional(),
  output: bashOutputSchema.optional(),
  error: localCallErrorSchema.optional(),
});
export type PollCallResponse = z.infer<typeof pollCallResponseSchema>;

/** The worker's question tool, the same shape the panel bridge already maps. */
export const questionOptionSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export const questionSchema = z.object({
  question: z.string().min(1).max(2000),
  header: z.string().max(60).optional(),
  options: z.array(questionOptionSchema).min(1).max(8),
  multiple: z.boolean().optional(),
  /** Offer a free-text answer next to the options. */
  allowOther: z.boolean().optional(),
});

export const startWaitBodySchema = z.object({
  kind: z.literal("question"),
  questions: z.array(questionSchema).min(1).max(4),
});

export const startWaitResponseSchema = z.object({
  waitId: z.string(),
});

export const WAIT_STATES = [
  "pending",
  "answered",
  "expired",
  "cancelled",
] as const;

/** The user's answer to one question: the labels picked, or their own words. */
export const questionAnswerSchema = z.object({
  question: z.string(),
  selected: z.array(z.string()),
  other: z.string().optional(),
});

export const pollWaitResponseSchema = z.object({
  waitId: z.string(),
  state: z.enum(WAIT_STATES),
  answers: z.array(questionAnswerSchema).optional(),
});
export type PollWaitResponse = z.infer<typeof pollWaitResponseSchema>;
