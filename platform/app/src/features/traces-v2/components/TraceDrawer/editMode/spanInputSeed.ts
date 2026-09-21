import { readSystemInstructions } from "~/server/tracer/spanIOStringify";

function isSystemMessageFor({
  message,
  instructions,
}: {
  message: unknown;
  instructions: string;
}): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.role === "system" && record.content === instructions;
}

/**
 * The captured input as the reviewer should edit it.
 *
 * The Input panel renders a chat transcript with the span's system prompt in
 * front of it, because the prompt steers the model and reading the transcript
 * without it is misleading. The trace itself stores the prompt as an attribute,
 * not as a message, so seeding the editor with what is on screen and saving it
 * would write the prompt into the correction as well and every dataset built
 * from the corrected trace would carry it twice. Take the rendered-in message
 * back out before it becomes something the reviewer can save.
 */
export function capturedInputForEditing({
  text,
  params,
}: {
  text: string | null;
  params: Record<string, unknown> | null | undefined;
}): string | null {
  if (text === null) return null;
  const instructions = readSystemInstructions(params);
  if (!instructions) return text;

  let messages: unknown;
  try {
    messages = JSON.parse(text) as unknown;
  } catch {
    return text;
  }
  if (!Array.isArray(messages)) return text;
  if (!isSystemMessageFor({ message: messages[0], instructions })) return text;
  return JSON.stringify(messages.slice(1));
}
