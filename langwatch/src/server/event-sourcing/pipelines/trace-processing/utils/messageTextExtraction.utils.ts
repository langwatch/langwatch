import { pipe } from "fp-ts/function";
import { last as getLast, map, filter } from "fp-ts/Array";
import { fold, fromNullable, getOrElse } from "fp-ts/Option";
import { match } from "ts-pattern";
import type { OpenTelemetryGenAIMessage } from "../schemas/messageSchemas";

/**
 * Utilities for converting OpenTelemetry GenAI messages to text.
 * Handles both simple string content and rich content arrays.
 *
 * @example
 * ```typescript
 * const text = chatMessagesToText(messages, false);
 * const lastMessageText = chatMessagesToText(messages, true);
 * ```
 */

type RichContentItem = { type?: string; text?: string; content?: string };

/**
 * Extracts text from a rich content item.
 */
const extractTextFromItem = (item: RichContentItem): string =>
  match(item)
    .when(
      (c) => c && typeof c === "object" && "text" in c && Boolean(c.text),
      (c) => c.text!,
    )
    .when(
      (c) => c && typeof c === "object" && "content" in c && Boolean(c.content),
      (c) => c.content!,
    )
    .otherwise((c) => JSON.stringify(c));

/**
 * Converts chat message content to text.
 * Handles string content, rich content arrays, and null/undefined.
 *
 * @param content - The message content (string, rich content array, or null/undefined)
 * @returns The extracted text content
 *
 * @example
 * ```typescript
 * const text = chatMessageContentToText(message.content);
 * ```
 */
function chatMessageContentToText(
  content: string | Array<RichContentItem> | null | undefined,
): string {
  return match(content)
    .with(null, undefined, () => "")
    .when(
      (c): c is string => typeof c === "string",
      (c) => c,
    )
    .when(Array.isArray, (arr) =>
      pipe(arr, map(extractTextFromItem), (parts) => parts.join("")),
    )
    .otherwise((c) => JSON.stringify(c));
}

/**
 * Converts chat messages to text.
 *
 * @param messages - Array of OpenTelemetry GenAI messages
 * @param last - If true, extracts only the last message (for outputs)
 * @returns The extracted text from all messages or just the last one
 *
 * @example
 * ```typescript
 * const allText = chatMessagesToText(messages, false);
 * const lastText = chatMessagesToText(messages, true);
 * ```
 */
function chatMessagesToText(
  messages: OpenTelemetryGenAIMessage[],
  last: boolean,
): string {
  if (last) {
    return pipe(
      messages,
      getLast,
      fold(
        () => "",
        (msg) => chatMessageContentToText(msg.content),
      ),
    );
  }

  return pipe(
    messages,
    map((msg) => chatMessageContentToText(msg.content)),
    (parts) => parts.join(""),
  );
}

/**
 * Type guard for text content items.
 */
const isTextContentItem = (
  item: unknown,
): item is { type: "text"; text: string } =>
  typeof item === "object" &&
  item !== null &&
  "type" in item &&
  (item as Record<string, unknown>).type === "text" &&
  "text" in item &&
  typeof (item as Record<string, unknown>).text === "string";

/**
 * Extracts text from rich content array, joining text items with newlines.
 * Only extracts items with type "text" and a "text" property.
 * Used for system instruction extraction where we want newline-separated text.
 *
 * @param content - Rich content array
 * @returns Extracted text joined with newlines, or empty string if no text found
 *
 * @example
 * ```typescript
 * const text = extractTextFromRichContent([
 *   { type: "text", text: "First line" },
 *   { type: "text", text: "Second line" }
 * ]); // Returns "First line\nSecond line"
 * ```
 */
function extractTextFromRichContent(content: Array<unknown>): string {
  return pipe(
    content,
    filter(isTextContentItem),
    map((item) => item.text),
    (parts) => parts.join("\n"),
  );
}

export {
  chatMessagesToText,
  chatMessageContentToText,
  extractTextFromRichContent,
};

export const MessageTextExtractionUtils = {
  chatMessagesToText,
  chatMessageContentToText,
  extractTextFromRichContent,
} as const;
