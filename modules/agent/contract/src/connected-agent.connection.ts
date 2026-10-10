import type { Named } from "@langwatch/module";
import { z } from "zod";

import type {
  CallFrame,
  CancelFrame,
  RefusedFrame,
  RegisteredFrame,
  SdkFrame,
} from "./connected-agent.protocol.ts";
import {
  ackFrameSchema,
  callFrameSchema,
  cancelFrameSchema,
  deregisterFrameSchema,
  refusedFrameSchema,
  registerFrameSchema,
  registeredFrameSchema,
  resultFrameSchema,
} from "./connected-agent.protocol.ts";

/** The caller the project door admitted, in the form a connected session stores it. */
const agentConnectCallerSchemaDefinition = z.object({
  project: z.object({ id: z.string(), slug: z.string() }),
  userId: z.string().nullable(),
  /** `user:<id>`, `key:<id>` or `legacy-project:<id>`: live sessions store it, never reword it. */
  principalId: z.string(),
});
export interface AgentConnectCallerSchema extends Named<
  typeof agentConnectCallerSchemaDefinition
> {}
export const agentConnectCallerSchema: AgentConnectCallerSchema =
  agentConnectCallerSchemaDefinition;

export type AgentConnectCaller = z.infer<typeof agentConnectCallerSchema>;

/** The protocol's own header: the instance token a poll and a frames post carry. */
const agentConnectHeadersSchemaDefinition = z.object({
  instanceToken: z.string().optional(),
});
export interface AgentConnectHeadersSchema extends Named<
  typeof agentConnectHeadersSchemaDefinition
> {}
export const agentConnectHeadersSchema: AgentConnectHeadersSchema =
  agentConnectHeadersSchemaDefinition;

const agentConnectCredentialsSchemaDefinition = z.object({
  ...agentConnectHeadersSchema.shape,
  caller: agentConnectCallerSchema,
});
export interface AgentConnectCredentialsSchema extends Named<
  typeof agentConnectCredentialsSchemaDefinition
> {}
export const agentConnectCredentialsSchema: AgentConnectCredentialsSchema =
  agentConnectCredentialsSchemaDefinition;

export type AgentConnectCredentials = z.infer<typeof agentConnectCredentialsSchema>;

/** What the socket's door decided: the admitted credentials, or the refusal to frame. */
const agentConnectAdmissionSchemaDefinition = z.union([
  z.object({ admitted: agentConnectCredentialsSchema }),
  z.object({ refused: z.instanceof(Error) }),
]);
export interface AgentConnectAdmissionSchema extends Named<
  typeof agentConnectAdmissionSchemaDefinition
> {}
export const agentConnectAdmissionSchema: AgentConnectAdmissionSchema =
  agentConnectAdmissionSchemaDefinition;

export type AgentConnectAdmission = z.infer<typeof agentConnectAdmissionSchema>;

export const agentConnectRegisterInputSchema = registerFrameSchema;
const agentConnectRegisterOutputSchemaDefinition = z.object({
  frame: z.union([registeredFrameSchema, refusedFrameSchema]),
  instanceToken: z.string().optional(),
});
export interface AgentConnectRegisterOutputSchema extends Named<
  typeof agentConnectRegisterOutputSchemaDefinition
> {}
export const agentConnectRegisterOutputSchema: AgentConnectRegisterOutputSchema =
  agentConnectRegisterOutputSchemaDefinition;
const agentConnectPollQuerySchemaDefinition = z.object({
  inFlight: z
    .string()
    .max(200_000)
    .optional()
    .catch(void 0),
});
export interface AgentConnectPollQuerySchema extends Named<
  typeof agentConnectPollQuerySchemaDefinition
> {}
export const agentConnectPollQuerySchema: AgentConnectPollQuerySchema =
  agentConnectPollQuerySchemaDefinition;
const agentConnectPollOutputSchemaDefinition = z.object({
  frames: z.array(z.union([callFrameSchema, cancelFrameSchema])),
});
export interface AgentConnectPollOutputSchema extends Named<
  typeof agentConnectPollOutputSchemaDefinition
> {}
export const agentConnectPollOutputSchema: AgentConnectPollOutputSchema =
  agentConnectPollOutputSchemaDefinition;
const agentConnectFramesInputSchemaDefinition = z.object({
  frames: z
    .array(z.union([ackFrameSchema, resultFrameSchema, deregisterFrameSchema]))
    .min(1)
    .max(100),
});
export interface AgentConnectFramesInputSchema extends Named<
  typeof agentConnectFramesInputSchemaDefinition
> {}
export const agentConnectFramesInputSchema: AgentConnectFramesInputSchema =
  agentConnectFramesInputSchemaDefinition;
const agentConnectFramesOutputSchemaDefinition = z.object({ accepted: z.number().int() });
export interface AgentConnectFramesOutputSchema extends Named<
  typeof agentConnectFramesOutputSchemaDefinition
> {}
export const agentConnectFramesOutputSchema: AgentConnectFramesOutputSchema =
  agentConnectFramesOutputSchemaDefinition;

export type AgentConnectRegisterInput = z.infer<typeof agentConnectRegisterInputSchema>;
export type AgentConnectRegisterOutput = z.infer<typeof agentConnectRegisterOutputSchema>;

/** A live protocol connection. HTTP and WebSocket implementation details stay in the framework. */
export interface AgentConnection {
  readonly open: boolean;
  onMessage(handler: (message: string) => void): () => void;
  onClose(handler: () => void): () => void;
  onPong(handler: () => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  send(message: string): boolean;
  ping(): void;
  close(code: number, reason: string): void;
  terminate(): void;
}

export type AgentConnectRegisterAnswer = {
  frame: RegisteredFrame | RefusedFrame;
  instanceToken?: string;
};

export interface AgentCallSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export type AgentConnectPollInput = {
  inFlightCallIds: string[];
  signal?: AgentCallSignal;
};

export type AgentConnectPollAnswer = { frames: (CallFrame | CancelFrame)[] };
export type AgentConnectFramesInput = {
  frames: Exclude<SdkFrame, { type: "register" }>[];
};
