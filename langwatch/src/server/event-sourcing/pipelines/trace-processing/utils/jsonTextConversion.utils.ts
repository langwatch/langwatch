import { pipe } from "fp-ts/function";
import { fromNullable, fold, map, chain } from "fp-ts/Option";
import { match, P } from "ts-pattern";

/**
 * Utilities for converting JSON values to text using framework-specific heuristics.
 * Supports various frameworks: LangChain, Flowise, Haystack, Chainlit, Langgraph, etc.
 *
 * @example
 * ```typescript
 * const text = jsonToText(jsonValue, false);
 * const isEmpty = isEmptyJson(jsonValue);
 * ```
 */

/**
 * Safely stringifies a value.
 *
 * @param value - The value to stringify
 * @returns The stringified value
 *
 * @example
 * ```typescript
 * const str = stringify({ key: "value" });
 * ```
 */
function stringify(value: unknown): string {
  return match(value)
    .when(
      (v): v is string => typeof v === "string",
      (v) => v,
    )
    .otherwise((v) => {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    });
}

/**
 * Direct keys that commonly contain the main content value.
 */
const DIRECT_KEYS = [
  "text",
  "input",
  "question",
  "user_query",
  "query",
  "input_value", // Langflow
  "output",
  "answer",
  "content", // Chainlit
  "prompt", // Haystack
] as const;

/**
 * Input keys for LangChain inputs object.
 */
const INPUT_KEYS = ["input", "text", "query", "question"] as const;

/**
 * Finds the first defined value from an object using the given keys.
 */
const findFirstDefinedKey = (
  obj: Record<string, unknown>,
  keys: readonly string[],
): unknown => {
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
};

/**
 * Extracts values from known special keys in JSON objects.
 * Supports various frameworks: LangChain, Flowise, Haystack, Chainlit, etc.
 *
 * @param json - The JSON value to extract from
 * @returns The extracted value, or undefined if no special keys found
 *
 * @example
 * ```typescript
 * const extracted = extractSpecialJsonKeys({ text: "Hello" });
 * ```
 */
function extractSpecialJsonKeys(json: unknown): unknown {
  return match(json)
    .with(P.nullish, () => undefined)
    .when(
      (j): j is Record<string, unknown> => typeof j === "object" && j !== null,
      (obj) => {
        // Try direct keys first
        const directValue = findFirstDefinedKey(obj, DIRECT_KEYS);
        if (directValue !== undefined) return directValue;

        // Message-specific keys
        if (typeof obj.message === "string") {
          return obj.message;
        }

        // Langgraph on Flowise
        if (
          Array.isArray(obj.messages) &&
          obj.messages.length > 0 &&
          obj.messages[obj.messages.length - 1]?.content !== undefined
        ) {
          return obj.messages[obj.messages.length - 1].content;
        }

        // LangChain return_values
        if (
          typeof obj.return_values === "object" &&
          obj.return_values !== null &&
          (obj.return_values as Record<string, unknown>).output !== undefined
        ) {
          return (obj.return_values as Record<string, unknown>).output;
        }

        // LangChain inputs
        if (typeof obj.inputs === "object" && obj.inputs !== null) {
          const inputValue = findFirstDefinedKey(
            obj.inputs as Record<string, unknown>,
            INPUT_KEYS,
          );
          if (inputValue !== undefined) return inputValue;
        }

        // LangChain outputs
        if (typeof obj.outputs === "object" && obj.outputs !== null) {
          const outputs = obj.outputs as Record<string, unknown>;
          if (outputs.output !== undefined) return outputs.output;
          if (outputs.text !== undefined) return outputs.text;
        }
        if (typeof obj.outputs === "string") {
          return obj.outputs;
        }

        // Haystack LLM replies
        if (
          typeof obj.llm === "object" &&
          obj.llm !== null &&
          Array.isArray((obj.llm as Record<string, unknown>).replies)
        ) {
          return ((obj.llm as Record<string, unknown>).replies as unknown[])[0];
        }

        // Langgraph.js
        if (Array.isArray(obj.messages) && obj.messages.length > 0) {
          const lastMsg = obj.messages[obj.messages.length - 1] as Record<
            string,
            unknown
          >;
          if (
            Array.isArray(lastMsg?.id) &&
            (lastMsg.id as string[]).includes("AIMessage") &&
            (lastMsg.kwargs as Record<string, unknown>)?.content
          ) {
            return (lastMsg.kwargs as Record<string, unknown>).content;
          }
        }

        // Optimization Studio
        if (obj.end !== undefined) {
          const endValue = extractSpecialJsonKeys(obj.end);
          return endValue !== undefined ? endValue : obj.end;
        }

        return undefined;
      },
    )
    .otherwise(() => undefined);
}

/**
 * If the JSON object has only one key, return its stringified value.
 *
 * @param json - The JSON value to check
 * @returns The stringified value of the single key, or undefined if not applicable
 *
 * @example
 * ```typescript
 * const value = firstAndOnlyKey({ key: "value" }); // Returns "value"
 * ```
 */
function firstAndOnlyKey(json: unknown): string | undefined {
  return pipe(
    fromNullable(json),
    chain((j) =>
      match(j)
        .when(
          (val): val is Record<string, unknown> =>
            typeof val === "object" &&
            val !== null &&
            !Array.isArray(val) &&
            Object.keys(val).length === 1,
          (val) => {
            const firstKey = Object.keys(val)[0]!;
            const firstItem = val[firstKey];

            // Try to extract special keys from the first item
            if (typeof firstItem === "object" && firstItem !== null) {
              const mapped = extractSpecialJsonKeys(firstItem);
              if (mapped !== undefined) {
                return fromNullable(stringify(mapped));
              }
            }

            return fromNullable(stringify(firstItem));
          },
        )
        .otherwise(() => fromNullable(undefined)),
    ),
    fold(
      () => undefined,
      (v) => v,
    ),
  );
}

/**
 * Checks if a JSON value is considered empty.
 *
 * @param value - The value to check
 * @returns True if the value is considered empty
 *
 * @example
 * ```typescript
 * const isEmpty = isEmptyJson({}); // true
 * const isEmpty2 = isEmptyJson({ key: {} }); // true (recursive check)
 * ```
 */
function isEmptyJson(value: unknown): boolean {
  return match(value)
    .with(P.nullish, () => true)
    .with("null", () => true)
    .with("{}", () => true)
    .when(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && !Array.isArray(v) && v !== null,
      (obj) => {
        const keys = Object.keys(obj);
        if (keys.length === 0) return true;

        // Recursively check single-key objects
        if (keys.length === 1) {
          return isEmptyJson(obj[keys[0]!]);
        }

        return false;
      },
    )
    .otherwise(() => false);
}

/**
 * Converts JSON value to text using framework-specific patterns.
 *
 * @param json - The JSON value to convert
 * @param last - If true, prioritizes last element in arrays (for outputs)
 * @returns The extracted text
 *
 * @example
 * ```typescript
 * const text = jsonToText({ text: "Hello" }, false);
 * const text2 = jsonToText([{ output: "World" }], true);
 * ```
 */
function jsonToText(json: unknown, _last: boolean): string {
  return match(json)
    .with(null, undefined, () => "")
    .otherwise((j) => {
      // Try special key mappings
      const specialValue = extractSpecialJsonKeys(j);
      if (specialValue !== undefined) {
        return firstAndOnlyKey(specialValue) ?? stringify(specialValue);
      }

      // Try array with single element
      if (Array.isArray(j) && j.length === 1) {
        const element = j[0];
        if (typeof element === "string") return element;
        const elementValue = extractSpecialJsonKeys(element);
        if (elementValue !== undefined) {
          return firstAndOnlyKey(elementValue) ?? stringify(elementValue);
        }
      }

      // Try first-and-only-key pattern
      const onlyKeyValue = firstAndOnlyKey(j);
      if (onlyKeyValue !== undefined) {
        return onlyKeyValue;
      }

      return stringify(j);
    });
}

export {
  stringify,
  extractSpecialJsonKeys,
  firstAndOnlyKey,
  isEmptyJson,
  jsonToText,
};

export const JsonTextConversionUtils = {
  stringify,
  extractSpecialJsonKeys,
  firstAndOnlyKey,
  isEmptyJson,
  jsonToText,
} as const;
