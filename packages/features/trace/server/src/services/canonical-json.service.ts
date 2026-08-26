import type { CanonicalAttributes } from "@langwatch/trace-contract";

const MAX_JSON_PARSE_SIZE = 2_000_000;

function sanitizeInvalidJsonEscapes(json: string): string {
  return json.replace(/\\([<>])/g, "$1");
}

export function parseJsonStringValues(
  attributes: CanonicalAttributes,
): CanonicalAttributes {
  const parsedAttributes: CanonicalAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string") {
      parsedAttributes[key] = value;
      continue;
    }

    const trimmed = value.trim();
    const looksLikeJson =
      trimmed.length >= 2 &&
      trimmed.length <= MAX_JSON_PARSE_SIZE &&
      ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]")));

    if (!looksLikeJson) {
      parsedAttributes[key] = value;
      continue;
    }

    try {
      parsedAttributes[key] = JSON.parse(trimmed);
    } catch {
      const sanitized = sanitizeInvalidJsonEscapes(trimmed);

      try {
        parsedAttributes[key] = sanitized === trimmed ? value : JSON.parse(sanitized);
      } catch {
        parsedAttributes[key] = value;
      }
    }
  }

  return parsedAttributes;
}
