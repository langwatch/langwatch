import { readSystemInstructions } from "@langwatch/trace-contract";

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
