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

export const agentConnectCredentialsSchema = z.object({
  authorization: z.string().optional(),
  projectId: z.string().optional(),
  instanceToken: z.string().optional(),
});

export type AgentConnectCredentials = z.infer<typeof agentConnectCredentialsSchema>;

export const agentConnectRegisterInputSchema = registerFrameSchema;
export const agentConnectRegisterOutputSchema = z.object({
  frame: z.union([registeredFrameSchema, refusedFrameSchema]),
  instanceToken: z.string().optional(),
});
export const agentConnectPollQuerySchema = z.object({
  inFlight: z
    .string()
    .max(200_000)
    .optional()
    .catch(void 0),
});
export const agentConnectPollOutputSchema = z.object({
  frames: z.array(z.union([callFrameSchema, cancelFrameSchema])),
});
export const agentConnectFramesInputSchema = z.object({
  frames: z
    .array(z.union([ackFrameSchema, resultFrameSchema, deregisterFrameSchema]))
    .min(1)
    .max(100),
});
export const agentConnectFramesOutputSchema = z.object({ accepted: z.number().int() });

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
