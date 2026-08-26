import { z } from "zod";

const structuredValueSchema = z.looseObject({
  type: z.string(),
  value: z.unknown(),
});

const messageRoleSchema = z.looseObject({
  role: z.string().optional(),
});

export type LangWatchStructuredValue = z.infer<typeof structuredValueSchema>;

export const isLangWatchStructuredValue = (
  value: unknown,
): value is LangWatchStructuredValue => structuredValueSchema.safeParse(value).success;

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * SDKs can capture an assistant reply after it has been appended to the input
 * history. Only the trailing assistant tail is removed; earlier turns remain.
 */
export function stripTrailingAssistantMessages(messages: unknown[]): unknown[] {
  let end = messages.length;

  while (end > 0) {
    const message = messageRoleSchema.safeParse(messages[end - 1]);
    if (!message.success || message.data.role !== "assistant") {
      break;
    }
    end--;
  }

  return end === messages.length ? messages : messages.slice(0, end);
}
