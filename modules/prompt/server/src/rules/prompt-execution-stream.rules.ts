/**
 * What one engine event means for the playground's stream.
 *
 * Pure, so the delta arithmetic and the run-is-over decision can be tested
 * without a socket: the transport owns the framing, this owns the reading.
 */
import type { PlaygroundStreamEvent } from "@langwatch/prompt-contract";
import type { StudioServerEvent } from "@langwatch/workflow-contract";

import { extractStreamableOutput, type OutputConfig } from "./prompt-output-format.rules.ts";
import { PROMPT_NODE_ID } from "./prompt-execution-event.rules.ts";

/**
 * The new text since the last chunk we sent.
 *
 * The engine reports the output field's whole current value on every state
 * change, so the delta is what has been appended. A value shorter than what we
 * already sent is a different field winning a race rather than the model
 * retracting what it said, so it is ignored.
 */
export function deltaFrom({
  outputs,
  outputConfigs,
  alreadySent,
}: {
  outputs: Record<string, unknown> | undefined;
  outputConfigs: OutputConfig[] | undefined;
  alreadySent: string;
}): { text: string; total: string } | undefined {
  const current = extractStreamableOutput(outputs, outputConfigs);
  if (current === undefined || current.length < alreadySent.length) {
    return undefined;
  }

  return { text: current.slice(alreadySent.length), total: current };
}

/**
 * Reads one engine event, sending whatever it means for the client.
 *
 * Returns `done` once the run is over, so the caller stops rather than the
 * handler having to reason about ordering.
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
    throw new Error(serverEvent.payload?.message ?? "An error occurred");
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
  if (delta?.text) send({ type: "delta", content: delta.text });

  if (state.error) throw new Error(state.error);

  return {
    sent: delta?.total ?? sentSoFar,
    done: state.status === "success",
  };
}
