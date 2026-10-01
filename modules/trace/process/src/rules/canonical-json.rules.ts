import type { CanonicalAttributes } from "@langwatch/trace-contract";

const MAX_JSON_PARSE_SIZE = 2_000_000;

function sanitizeInvalidJsonEscapes(json: string): string {
  return json.replace(/\\([<>])/g, "$1");
}

/** One attribute value: JSON-parsed when it plausibly holds JSON, returned verbatim otherwise. */
function parseJsonStringValue(value: string): CanonicalAttributes[string] {
  const trimmed = value.trim();
  const isJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const isJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  const looksLikeJson =
    trimmed.length >= 2 && trimmed.length <= MAX_JSON_PARSE_SIZE && (isJsonObject || isJsonArray);
  if (!looksLikeJson) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return parseSanitizedJsonValue({ trimmed, value });
  }
}

/** The second attempt, after the escapes an SDK emits that JSON does not allow are removed. */
function parseSanitizedJsonValue({
  trimmed,
  value,
}: {
  trimmed: string;
  value: string;
}): CanonicalAttributes[string] {
  const sanitized = sanitizeInvalidJsonEscapes(trimmed);
  try {
    return sanitized === trimmed ? value : JSON.parse(sanitized);
  } catch {
    return value;
  }
}

export function parseJsonStringValues(attributes: CanonicalAttributes): CanonicalAttributes {
  const parsedAttributes: CanonicalAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    parsedAttributes[key] = typeof value === "string" ? parseJsonStringValue(value) : value;
  }

  return parsedAttributes;
}
