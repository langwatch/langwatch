/**
 * The state a scenario hook or a turn answers with: a JSON object under the
 * platform's cap (ADR-180).
 * @see dev/docs/adr/180-scenario-run-hooks.md
 */

import type { ScenarioState } from "./protocol";

/** The cap on a state and on teardown's returned object, the `session` cap. */
export const STATE_MAX_BYTES = 64 * 1024;

/** A state the platform would refuse, answered with its own error code. */
export class AgentStateError extends Error {
  constructor(
    readonly code: "agent_call_failed" | "agent_payload_too_large",
    message: string,
  ) {
    super(message);
    this.name = "AgentStateError";
  }
}

const isPlainObject = (value: unknown): value is ScenarioState =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The state to send, undefined for none; throws `AgentStateError` for one the platform refuses. */
export function checkState(value: unknown): ScenarioState | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new AgentStateError(
      "agent_call_failed",
      `the state must be a JSON object, got ${Array.isArray(value) ? "an array" : typeof value}`,
    );
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new AgentStateError(
      "agent_call_failed",
      `the state is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const sizeBytes = Buffer.byteLength(encoded, "utf8");
  if (sizeBytes > STATE_MAX_BYTES) {
    throw new AgentStateError(
      "agent_payload_too_large",
      `The state is ${sizeBytes} bytes, above the limit of ${STATE_MAX_BYTES} bytes.`,
    );
  }
  return value;
}
