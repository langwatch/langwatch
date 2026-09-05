import { safeUnflatten } from "@langwatch/trace-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

const SEP = ".";

// Regex to match keys with numeric array indices: prefix.N.remainder
const INDEXED_KEY_REGEX = /^(.+?)\.(\d+)\.(.+)$/;

type ArrayPatternMap = Map<string, Map<number, Map<string, unknown>>>;

/**
 * Scans all keys to find potential flattened array patterns.
 * Groups them by prefix, index, and relative path.
 *
 * For input like:
 *   "llm.input_messages.0.message.content" => "hello"
 *   "llm.input_messages.0.message.role" => "user"
 *   "llm.input_messages.1.message.content" => "hi"
 *   "llm.input_messages.1.message.role" => "assistant"
 *
 * Returns a Map where:
 *   key: "llm.input_messages"
 *   value: Map {
 *     0 => Map { "message.content" => "hello", "message.role" => "user" },
 *     1 => Map { "message.content" => "hi", "message.role" => "assistant" }
 *   }
 */
const detectArrayPatterns = (
  attrs: NormalizedAttributes,
): { patterns: ArrayPatternMap; matchedKeys: Set<string> } => {
  const patterns: ArrayPatternMap = new Map();
  const matchedKeys = new Set<string>();

  for (const [key, value] of Object.entries(attrs)) {
    const indexed = INDEXED_KEY_REGEX.exec(key);
    if (indexed?.length !== 4) {
      continue;
    }

    const [, prefix, indexStr, remainder] = indexed;
    if (!prefix || !indexStr || !remainder) {
      continue;
    }

    const index = parseInt(indexStr, 10);
    if (!patterns.has(prefix)) {
      patterns.set(prefix, new Map());
    }

    const indexMap = patterns.get(prefix)!;
    if (!indexMap.has(index)) {
      indexMap.set(index, new Map());
    }

    indexMap.get(index)!.set(remainder, value);
    matchedKeys.add(key);
  }

  return { patterns, matchedKeys };
};

/**
 * Validates that a detected array pattern has:
 * 1. Consecutive indices starting from 0
 * 2. Same set of relative keys across all items
 */
const isValidArrayPattern = (indexMap: Map<number, Map<string, unknown>>): boolean => {
  const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);

  // Must start at 0
  if (indices.length === 0 || indices[0] !== 0) {
    return false;
  }

  // Must be consecutive
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      return false;
    }
  }

  // All items must have the same set of relative keys
  const keySignatures = new Set<string>();
  for (const [, relativeMap] of indexMap) {
    const keys = Array.from(relativeMap.keys()).sort().join("\0");
    keySignatures.add(keys);
  }

  // If there's more than one unique key signature, shapes are inconsistent
  return keySignatures.size === 1;
};

/**
 * Reconstructs a nested object from flattened key-value pairs.
 * Delegates to shared safeUnflatten for prototype pollution protection.
 *
 * For input:
 *   Map { "message.content" => "hello", "message.role" => "user" }
 *
 * Returns:
 *   { message: { content: "hello", role: "user" } }
 */
const unflattenObject = (flatMap: Map<string, unknown>): Record<string, unknown> => {
  const record: Record<string, unknown> = Object.create(null);
  for (const [k, v] of flatMap) {
    record[k] = v;
  }

  return safeUnflatten(record);
};

/**
 * Post-processes normalized attributes to reconstruct flattened arrays.
 *
 * Converts patterns like:
 *   "llm.input_messages.0.message.content" => "hello"
 *   "llm.input_messages.0.message.role" => "user"
 *   "llm.input_messages.1.message.content" => "hi"
 *
 * Into:
 *   "llm.input_messages" => [{message:{content:"hello",role:"user"}},{message:{content:"hi"}}]
 */
const reconstructFlattenedArrays = (attrs: NormalizedAttributes): NormalizedAttributes => {
  const { patterns, matchedKeys } = detectArrayPatterns(attrs);

  // If no patterns found, return original
  if (patterns.size === 0) {
    return attrs;
  }

  const result: NormalizedAttributes = {};
  const processedPrefixes = new Set<string>();

  // Copy over non-matched keys
  for (const [key, value] of Object.entries(attrs)) {
    if (!matchedKeys.has(key)) {
      result[key] = value;
    }
  }

  // Process each detected array pattern
  for (const [prefix, indexMap] of patterns) {
    if (!isValidArrayPattern(indexMap)) {
      // Invalid pattern - copy original keys back
      for (const [index, relativeMap] of indexMap) {
        for (const [relativePath, value] of relativeMap) {
          result[`${prefix}${SEP}${index}${SEP}${relativePath}`] = value;
        }
      }

      continue;
    }

    processedPrefixes.add(prefix);

    // Build the array
    const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);
    const arrayItems: Record<string, unknown>[] = [];

    for (const index of indices) {
      const relativeMap = indexMap.get(index)!;
      const item = unflattenObject(relativeMap);
      arrayItems.push(item);
    }

    // Store as real array (not JSON string)
    result[prefix] = arrayItems;
  }

  return result;
};

/**
 * Maximum string size to attempt synchronous JSON parsing.
 * Strings larger than this are left as-is to avoid blocking the event loop.
 */
const MAX_JSON_PARSE_SIZE = 2_000_000;

/**
 * Fixes invalid JSON escape sequences introduced by PII redaction.
 * PII redaction replaces content with `<PII_TYPE>` tokens (e.g. `<US_DRIVER_LICENSE>`).
 * When this happens inside a JSON string value, it can create invalid escapes
 * like `\<` if the replacement lands right after a backslash.
 *
 * Specifically targets `\<` and `\>` which are the known invalid escapes
 * from PII redaction tokens like `<US_DRIVER_LICENSE>`.
 */
/** @internal Exported for unit testing */
function sanitizeInvalidJsonEscapes(json: string): string {
  return json.replace(/\\([<>])/g, "$1");
}

/**
 * Parses string values that look like JSON into their parsed form.
 * Scalars and already-parsed values pass through unchanged.
 *
 * Fast-path: only attempts parse if the trimmed string starts with `{` or `[`.
 */
/** @internal Exported for unit testing */
const parseJsonStringValues = (attrs: NormalizedAttributes): NormalizedAttributes => {
  const result: NormalizedAttributes = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > MAX_JSON_PARSE_SIZE) {
      result[key] = value;
      continue;
    }

    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));

    if (!looksJson) {
      result[key] = value;
      continue;
    }

    try {
      result[key] = JSON.parse(trimmed);
    } catch {
      // PII redaction can introduce invalid JSON escapes like \<US_DRIVER_LICENSE>
      // because it replaces content with <PII_TYPE> tokens inside JSON strings.
      // Try to fix known invalid escapes before giving up.
      const sanitized = sanitizeInvalidJsonEscapes(trimmed);
      if (sanitized !== trimmed) {
        try {
          result[key] = JSON.parse(sanitized);
          continue;
        } catch {
          // still broken, fall through
        }
      }

      result[key] = value;
    }
  }

  return result;
};

/** OTLP attribute shaping: flattened-array reconstruction and JSON-string parsing. */
export class OtlpAttributeFlatteningService {
  private constructor() {}

  static create(): OtlpAttributeFlatteningService {
    return new OtlpAttributeFlatteningService();
  }

  static reconstructFlattenedArrays = reconstructFlattenedArrays;
  static sanitizeInvalidJsonEscapes = sanitizeInvalidJsonEscapes;
  static parseJsonStringValues = parseJsonStringValues;
}
