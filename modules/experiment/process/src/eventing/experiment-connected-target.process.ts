/**
 * Structures for workbench columns sending input to a connected agent and reading the answer back.
 * See ADR-128 and specs/experiments-v3/connected-agent-target.feature for the full contract.
 */

// The relay's wire shapes (ADR-128), which the Agent feature package owns.
import type { CallOutput, ProtocolMessage } from "@langwatch/agent-contract";
import {
  CONNECTED_ATTACHMENT_FIELD,
  CONNECTED_INPUT_FIELD,
  UNNAMED_FAILURE,
} from "@langwatch/experiment-contract";
import type { SerializedHandledError } from "@langwatch/handled-error";
import { HandledError } from "@langwatch/handled-error";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

import { toAttachmentContentPart } from "#rules/attachment-parts.rules";

/**
 * How long a row keeps waiting for a busy agent before it fails — the same
 * budget a simulation turn gives it, so an agent taking one call at a time
 * reads the same behavior on both screens.
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
 * The conversation for one row: the input as one user message, with a mapped
 * attachment as a content part beside it. A column of chat messages is already
 * a conversation and travels as it is, so a multi-turn dataset replays.
 */
const messagesOf = ({
  value,
  attachment,
}: {
  value: unknown;
  attachment: unknown;
}): ProtocolMessage[] => {
  if (Array.isArray(value)) {
    const messages = value.filter(
      (entry): entry is ProtocolMessage =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { role?: unknown }).role === "string",
    );
    if (messages.length > 0) return messages;
  }
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");

  const part =
    typeof attachment === "string" && attachment !== ""
      ? toAttachmentContentPart(attachment)
      : null;
  if (!part) return [{ role: "user", content: text }];

  // A turn with a picture or a document is a list of parts, which is how an
  // OpenAI style message carries both. The text part is left out when the row
  // maps no text, so the agent reads the attachment alone rather than an empty
  // question in front of it.
  return [
    {
      role: "user",
      content: text ? [{ type: "text", text }, part] : [part],
    },
  ];
};

/** A mapped cell that holds a number, or nothing when it holds no number. */
const coerceNumberValue = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** A mapped cell that holds a truth value, written either way round. */
const coerceBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
};

/**
 * A value read as the type the parameter declares, or nothing — both an
 * empty cell and one the declared type can't read. Left out of the call so
 * the function's own default applies, not the agent seeing `NaN` or "undefined".
 */
const coerceParameterValue = ({
  value,
  definition,
}: {
  value: unknown;
  definition: ScenarioParameterDefinition;
}): string | number | boolean | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (definition.type === "number") return coerceNumberValue(value);
  if (definition.type === "boolean") return coerceBooleanValue(value);
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
};

/**
 * The turn for one row: the conversation and the agent's declared parameter
 * values. Only declared names are sent; an input naming nothing the agent
 * declares is dropped, because the SDK refuses a parameter with no argument.
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
    const value = coerceParameterValue({
      value: inputs[definition.name],
      definition,
    });
    // A parameter with no value keeps the default the function declares, so
    // nothing is sent for it.
    if (value !== undefined) params[definition.name] = value;
  }
  return {
    messages: messagesOf({
      value: inputs[CONNECTED_INPUT_FIELD],
      attachment: inputs[CONNECTED_ATTACHMENT_FIELD],
    }),
    params,
  };
};

/** The text of one content part: a string, or a part carrying `text`. */
const partText = (part: unknown): string => {
  if (typeof part === "string") return part;
  if (typeof (part as { text?: unknown })?.text === "string")
    return (part as { text: string }).text;
  return "";
};

/** The text of one message, whatever shape its content has. */
const contentText = (message: ProtocolMessage): string => {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(partText).join("");
  }
  return content === undefined ? "" : JSON.stringify(content);
};

/**
 * What the cell shows. The function may answer with text, one message or a
 * list of them (the relay's output contract); an evaluator mapped to the
 * column reads one text either way — a list as its last message.
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
 * A failed call as the cell records it. A handled error travels by its code,
 * so the cell renders the registered copy (ADR-045) rather than a stack
 * message; anything else is unnamed and reads as the generic failure.
 */
export const connectedCallFailure = (
  error: unknown,
): { message: string; domainError?: SerializedHandledError } => {
  if (HandledError.isHandled(error)) {
    return { message: error.code, domainError: error.serialize() };
  }
  return { message: UNNAMED_FAILURE };
};
