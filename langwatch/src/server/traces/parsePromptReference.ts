/**
 * Result of parsing prompt reference from span attributes.
 */
export interface PromptReference {
  promptHandle: string | null;
  promptVersionNumber: number | null;
}

/**
 * Parses prompt handle and version number from span attributes.
 *
 * Supports two formats:
 * 1. New combined format: `langwatch.prompt.id = "handle:version_number"`
 * 2. Old separate format: `langwatch.prompt.handle` + `langwatch.prompt.version.number`
 *
 * Uses `lastIndexOf(':')` to split because handles may contain `/` but never `:`.
 * Version must be a positive integer.
 *
 * @param attrs - Span attributes record
 * @returns Parsed prompt reference with handle and version, or nulls if not found
 */
export function parsePromptReference(
  attrs: Record<string, unknown>,
): PromptReference {
  const nullResult: PromptReference = {
    promptHandle: null,
    promptVersionNumber: null,
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
        return { promptHandle: handle, promptVersionNumber: version };
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
      return { promptHandle: handle, promptVersionNumber: version };
    }
  }

  return nullResult;
}
