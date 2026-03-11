/**
 * Result of parsing prompt reference from span attributes.
 */
export interface PromptReference {
  promptHandle: string | null;
  promptVersionNumber: number | null;
  promptVariables: Record<string, string> | null;
}

/**
 * Parses prompt handle and version number from span attributes.
 *
 * Supports two formats:
 * 1. New combined format: `langwatch.prompt.id = "handle:version_number"`
 * 2. Old separate format: `langwatch.prompt.handle` + `langwatch.prompt.version.number`
 *
 * Also extracts `langwatch.prompt.variables` when present.
 * The format is: `'{"type":"json","value":{"name":"Alice","topic":"AI"}}'`
 *
 * Uses `lastIndexOf(':')` to split because handles may contain `/` but never `:`.
 * Version must be a positive integer.
 *
 * @param attrs - Span attributes record
 * @returns Parsed prompt reference with handle, version, and variables, or nulls if not found
 */
export function parsePromptReference(
  attrs: Record<string, unknown>,
): PromptReference {
  const variables = parsePromptVariables(attrs);

  const nullResult: PromptReference = {
    promptHandle: null,
    promptVersionNumber: null,
    promptVariables: variables,
  };

  // Try new combined format first
  const promptId = attrs["langwatch.prompt.id"];
  if (typeof promptId === "string" && promptId.includes(":")) {
    const colonIndex = promptId.lastIndexOf(":");
    const handle = promptId.substring(0, colonIndex);
    const versionStr = promptId.substring(colonIndex + 1);

    if (handle.length > 0) {
      const version = Number(versionStr);
      if (Number.isInteger(version) && version > 0) {
        return {
          promptHandle: handle,
          promptVersionNumber: version,
          promptVariables: variables,
        };
      }
    }

    return nullResult;
  }

  // Try old separate format
  const handle = attrs["langwatch.prompt.handle"];
  const versionRaw = attrs["langwatch.prompt.version.number"];

  if (typeof handle === "string" && handle.length > 0 && versionRaw != null) {
    const version = Number(versionRaw);
    if (Number.isInteger(version) && version > 0) {
      return {
        promptHandle: handle,
        promptVersionNumber: version,
        promptVariables: variables,
      };
    }
  }

  return nullResult;
}

/**
 * Parses prompt variables from span attributes.
 *
 * The expected format is a JSON string:
 * `'{"type":"json","value":{"name":"Alice","topic":"AI"}}'`
 *
 * Extracts `.value` and converts all values to strings.
 *
 * @param attrs - Span attributes record
 * @returns Record of variable names to string values, or null if not found/invalid
 */
function parsePromptVariables(
  attrs: Record<string, unknown>,
): Record<string, string> | null {
  const raw = attrs["langwatch.prompt.variables"];
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("value" in parsed)
    ) {
      return null;
    }

    const value = (parsed as { value: unknown }).value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }

    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = String(val);
    }
    return result;
  } catch {
    return null;
  }
}
