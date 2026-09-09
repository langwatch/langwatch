/**
 * What a workbench column sends to a connected agent, and what it reads back.
 *
 * A connected agent runs in the customer's own process and is reached through
 * the relay (ADR-128). A workbench row is one turn: the column sends the
 * mapped input as a single user message, carries the parameter values the
 * agent declares, and writes the answer in the cell.
 *
 * The call itself is dispatched by the orchestrator. This module holds the
 * parts that need no runtime: what to send, what the answer reads as, and
 * what a failure is called.
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */

import type { SerializedHandledError } from "@langwatch/handled-error";
import { HandledError } from "@langwatch/handled-error";
import { CONNECTED_INPUT_FIELD, UNNAMED_FAILURE } from "@langwatch/experiment-contract";
// The relay's wire shapes (ADR-128), which the Agent feature package owns.
import type { CallOutput, ProtocolMessage } from "@langwatch/agent-contract";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

/**
 * How long a row keeps waiting for a busy agent before it fails.
 *
 * The same budget a simulation turn gives it, so a customer whose agent takes
 * one call at a time reads one behavior on both screens.
 */
export const CONNECTED_BUSY_RETRY_BUDGET_MS = 60_000;

/** Slack over the agent's own budget before the row abandons the call. */
export const CONNECTED_REQUEST_SLACK_MS = 15_000;

/** What the column sends for one row. */
export type ConnectedTargetCall = {
  messages: ProtocolMessage[];
  params: Record<string, string | number | boolean>;
};

/**
 * The conversation for one row.
 *
 * A string input is the customer's own question and becomes one user message.
 * A dataset column of chat messages is already a conversation and travels as
 * it is, so a multi-turn dataset can be replayed against the agent.
 */
const messagesOf = (value: unknown): ProtocolMessage[] => {
  if (Array.isArray(value)) {
    const messages = value.filter(
      (entry): entry is ProtocolMessage =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { role?: unknown }).role === "string",
    );
    if (messages.length > 0) return messages;
  }
  const content = typeof value === "string" ? value : value === undefined ? "" : String(value);
  return [{ role: "user", content }];
};

/** A mapped cell that holds a number, or nothing when it holds no number. */
const numberValueOf = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** A mapped cell that holds a truth value, written either way round. */
const booleanValueOf = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
};

/**
 * A value read as the type the parameter declares, or nothing.
 *
 * A cell that holds nothing, and a value the declared type cannot read, both
 * read as nothing: the parameter is left out of the call and the function
 * applies its own default, rather than the agent receiving `NaN` or the text
 * "undefined".
 */
const parameterValueOf = ({
  value,
  definition,
}: {
  value: unknown;
  definition: ScenarioParameterDefinition;
}): string | number | boolean | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (definition.type === "number") return numberValueOf(value);
  if (definition.type === "boolean") return booleanValueOf(value);
  return typeof value === "string" ? value : String(value);
};

/**
 * The turn for one row: the conversation, and the parameter values the agent
 * declared.
 *
 * Only declared names are sent. A column input that names nothing the agent
 * declares is dropped rather than passed through, because the SDK refuses a
 * parameter the function has no argument for.
 */
export const buildConnectedCall = ({
  inputs,
  definitions,
}: {
  inputs: Record<string, unknown>;
  definitions: ScenarioParameterDefinition[];
}): ConnectedTargetCall => {
  const params: Record<string, string | number | boolean> = {};
  for (const definition of definitions) {
    const value = parameterValueOf({
      value: inputs[definition.name],
      definition,
    });
    // A parameter with no value keeps the default the function declares, so
    // nothing is sent for it.
    if (value !== undefined) params[definition.name] = value;
  }
  return { messages: messagesOf(inputs[CONNECTED_INPUT_FIELD]), params };
};

/** The text of one message, whatever shape its content has. */
const contentText = (message: ProtocolMessage): string => {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { text?: unknown })?.text === "string"
            ? (part as { text: string }).text
            : "",
      )
      .join("");
  }
  return content === undefined ? "" : JSON.stringify(content);
};

/**
 * What the cell shows.
 *
 * The function may answer with text, one message or a list of them (the
 * relay's output contract), and an evaluator mapped to the column reads one
 * text either way. A list is read as its last message, which is the agent's
 * answer to this turn.
 */
export const connectedOutputText = (output: CallOutput): string => {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const last = output[output.length - 1];
    return last ? contentText(last) : "";
  }
  return contentText(output);
};

/**
 * A failed call as the cell records it.
 *
 * A handled error travels by its code, so the cell renders the copy that code
 * is registered with (ADR-045): "no process of this agent is connected", not
 * a stack message. Anything else is unnamed and reads as the generic failure,
 * which is what an unanticipated fault should look like.
 */
export const connectedCallFailure = (
  error: unknown,
): { message: string; domainError?: SerializedHandledError } => {
  if (HandledError.isHandled(error)) {
    return { message: error.code, domainError: error.serialize() };
  }
  return { message: UNNAMED_FAILURE };
};
