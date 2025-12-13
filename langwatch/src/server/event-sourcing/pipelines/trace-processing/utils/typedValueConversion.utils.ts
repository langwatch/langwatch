import { chatMessagesToText } from "./messageTextExtraction.utils";
import { jsonToText, stringify } from "./jsonTextConversion.utils";
import type { TypedValue } from "./typedValueExtraction.utils";

/**
 * Utilities for converting typed values to text.
 * Uses shared message and JSON conversion utilities.
 *
 * @example
 * ```typescript
 * const text = typedValueToText(typedValue, false);
 * const lastText = typedValueToText(typedValue, true);
 * ```
 */

import { match } from "ts-pattern";

/**
 * Converts a typed value to text using framework-specific heuristics.
 *
 * @param typed - The typed value to convert
 * @param last - If true, extracts only the last message (for outputs)
 * @returns The extracted text
 *
 * @example
 * ```typescript
 * const text = typedValueToText({ type: "text", value: "Hello" }, false);
 * const messagesText = typedValueToText({ type: "chat_messages", value: [...] }, true);
 * ```
 */
function typedValueToText(typed: TypedValue, last: boolean): string {
  return match(typed)
    .with({ type: "text" }, ({ value }) => value)
    .with({ type: "chat_messages" }, ({ value }) =>
      chatMessagesToText(value, last),
    )
    .with({ type: "json" }, ({ value }) => jsonToText(value, last))
    .with({ type: "raw" }, ({ value }) => stringify(value))
    .exhaustive();
}

export { typedValueToText };

export const TypedValueConversionUtils = {
  typedValueToText,
} as const;
