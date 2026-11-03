import type { CallEnvelope, CallKind, CallOutput } from "./connected-agent.protocol.ts";

/** What a caller hands the dispatcher for one turn. */
export interface DispatchCall {
  threadId: string;
  messages: CallEnvelope["messages"];
  newMessages: CallEnvelope["newMessages"];
  params: CallEnvelope["params"];
  session: unknown;
  traceparent: string | null;
  run: CallEnvelope["run"];
  /** Absent means a turn. */
  kind?: CallKind;
  state?: CallEnvelope["state"];
  /** A hook's own budget; a turn runs under the agent's timeout. */
  timeoutMs?: number;
}

/** What the dispatcher needs to know about the agent. */
export interface DispatchAgent {
  id: string;
  name: string;
  environment: string | null;
  /** The per-call budget, already capped by the caller. */
  timeoutMs: number;
  /** Whether a thread is pinned to the instance that served its first turn. */
  isSticky: boolean;
}

/** What one dispatched turn answers with. */
export interface CallOutcome {
  output: CallOutput;
  session?: unknown;
  state?: CallEnvelope["state"];
  instance: { instanceId: string; hostname: string; label: string | null };
  durationMs: number;
}
