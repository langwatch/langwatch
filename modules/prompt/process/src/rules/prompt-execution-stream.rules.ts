/**
 * What one engine event means for the playground's stream. Pure, so the
 * delta arithmetic and run-is-over decision test without a socket: the
 * transport owns the framing, this owns the reading.
 */
import {
  parseLLMError,
  type LLMErrorType,
  type ParsedLLMError,
  type PlaygroundStreamEvent,
} from "@langwatch/prompt-contract";
import type { StudioServerEvent } from "@langwatch/workflow-contract";

import { PROMPT_NODE_ID } from "./prompt-execution-event.rules.ts";
import { extractStreamableOutput, type OutputConfig } from "./prompt-output-format.rules.ts";

/** An engine failure that kept the HTTP status the model provider answered with. */
export function engineRunError(message: string, upstreamStatus?: number): Error {
  return Object.assign(new Error(message), { upstreamStatus });
}

const TYPE_BY_STATUS: Record<number, LLMErrorType> = {
  400: "bad_request",
  401: "auth",
  403: "auth",
  404: "not_found",
  429: "rate_limit",
};

/** The failure class the user sees: the provider's status when kept, else the message text. */
export function llmErrorOf(error: unknown): ParsedLLMError {
  const message = error instanceof Error ? error.message : String(error);
  const parsed = parseLLMError(message);
  const status =
    error instanceof Error && "upstreamStatus" in error && typeof error.upstreamStatus === "number"
      ? error.upstreamStatus
      : undefined;
  const type = status === undefined ? undefined : TYPE_BY_STATUS[status];
  return parsed.type === "unknown" && type ? { type, message } : parsed;
}

/**
 * The new text since the last chunk sent. The engine reports the field's
 * whole current value each time, so a shorter value is a different field
 * winning a race (not a retraction) and is ignored - text empty, total unmoved.
 */
function deltaFrom({
  outputs,
  outputConfigs,
  alreadySent,
}: {
  outputs: Record<string, unknown> | undefined;
  outputConfigs: OutputConfig[] | undefined;
  alreadySent: string;
}): { text: string; total: string } {
  const current = extractStreamableOutput(outputs, outputConfigs);
  if (current === undefined || current.length < alreadySent.length) {
    return { text: "", total: alreadySent };
  }

  return { text: current.slice(alreadySent.length), total: current };
}

/**
 * Reads one engine event, sending whatever it means for the client. Returns
 * `done` once the run is over, so the caller stops without reasoning about ordering.
 */
export function handleEngineEvent({
  serverEvent,
  outputConfigs,
  sentSoFar,
  send,
}: {
  serverEvent: StudioServerEvent;
  outputConfigs: OutputConfig[] | undefined;
  sentSoFar: string;
  send: (event: PlaygroundStreamEvent) => void;
}): { sent: string; done: boolean } {
  if (serverEvent.type === "error") {
    throw engineRunError(serverEvent.payload?.message ?? "An error occurred");
  }

  if (serverEvent.type === "done") return { sent: sentSoFar, done: true };

  if (
    serverEvent.type !== "component_state_change" ||
    serverEvent.payload?.component_id !== PROMPT_NODE_ID
  ) {
    return { sent: sentSoFar, done: false };
  }

  const state = serverEvent.payload.execution_state;
  if (!state) return { sent: sentSoFar, done: false };

  const delta = deltaFrom({
    outputs: state.outputs,
    outputConfigs,
    alreadySent: sentSoFar,
  });
  if (delta.text) send({ type: "delta", content: delta.text });

  if (state.error) throw engineRunError(state.error, state.upstream_status);

  return {
    sent: delta.total,
    done: state.status === "success",
  };
}
