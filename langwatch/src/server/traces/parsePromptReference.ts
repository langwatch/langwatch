import { parsePromptShorthand } from "../prompt-config/parsePromptShorthand";

/**
 * Result of parsing prompt reference from span attributes.
 */
export interface PromptReference {
  promptHandle: string | null;
  promptVersionNumber: number | null;
  promptVersionId: string | null;
  promptTag: string | null;
  promptVariables: Record<string, string> | null;
}

const ATTR_PROMPT_ID = "langwatch.prompt.id";
const ATTR_PROMPT_HANDLE = "langwatch.prompt.handle";
const ATTR_PROMPT_VERSION_NUMBER = "langwatch.prompt.version.number";
const ATTR_PROMPT_VERSION_ID = "langwatch.prompt.version.id";
const ATTR_PROMPT_VARIABLES = "langwatch.prompt.variables";
const ATTR_PROMPT_VARIABLES_PREFIX = "langwatch.prompt.variables.";

/**
 * Parses prompt handle, version number, version id, and tag from span attributes.
 *
 * Supports four formats, ordered by current SDK preference:
 *
 * 1. Flat (preferred): `langwatch.prompt.id` is a bare slug, with
 *    `langwatch.prompt.version.id` and/or `langwatch.prompt.version.number`
 *    carried separately. Each concept is its own attribute — the OTel idiom.
 * 2. Combined with version: `langwatch.prompt.id = "handle:5"`.
 * 3. Combined with tag: `langwatch.prompt.id = "handle:production"`.
 * 4. Legacy separated: `langwatch.prompt.handle` + `langwatch.prompt.version.number`.
 *
 * Variables come from either:
 * - Flat keys `langwatch.prompt.variables.<name>` (preferred, queryable as
 *   first-class attributes), or
 * - The legacy JSON blob `langwatch.prompt.variables = '{"type":"json","value":{...}}'`.
 *
 * Flat variable keys win when both are present.
 *
 * Uses `lastIndexOf(':')` to split the combined `prompt.id` form because
 * handles may contain `/` but never `:`. Disambiguation: positive integer
 * suffix → version; otherwise → tag. `"latest"` suffix is treated as a no-op.
 */
export function parsePromptReference(
  attrs: Record<string, unknown>,
): PromptReference {
  const variables = parsePromptVariables(attrs);
  const versionIdRaw = attrs[ATTR_PROMPT_VERSION_ID];
  const versionId =
    typeof versionIdRaw === "string" && versionIdRaw.length > 0
      ? versionIdRaw
      : null;

  const nullResult: PromptReference = {
    promptHandle: null,
    promptVersionNumber: null,
    promptVersionId: versionId,
    promptTag: null,
    promptVariables: variables,
  };

  const promptId = attrs[ATTR_PROMPT_ID];

  // Combined format: `handle:<version_or_tag>`.
  if (typeof promptId === "string" && promptId.includes(":")) {
    try {
      const shorthand = parsePromptShorthand(promptId);
      return {
        promptHandle: shorthand.slug,
        promptVersionNumber: shorthand.version ?? null,
        promptVersionId: versionId,
        promptTag: shorthand.tag ?? null,
        promptVariables: variables,
      };
    } catch {
      // Invalid shorthand (e.g., empty slug) — bail to nullResult.
      return nullResult;
    }
  }

  // Flat format: bare-slug `prompt.id` with version carried in its own
  // attribute. Pair with `version.number` if present so the rollup gets a
  // human-readable version too.
  if (typeof promptId === "string" && promptId.length > 0) {
    const versionNumber = parseVersionNumber(attrs[ATTR_PROMPT_VERSION_NUMBER]);
    return {
      promptHandle: promptId,
      promptVersionNumber: versionNumber,
      promptVersionId: versionId,
      promptTag: null,
      promptVariables: variables,
    };
  }

  // Legacy separated format.
  const handle = attrs[ATTR_PROMPT_HANDLE];
  if (typeof handle === "string" && handle.length > 0) {
    const versionNumber = parseVersionNumber(attrs[ATTR_PROMPT_VERSION_NUMBER]);
    if (versionNumber !== null) {
      return {
        promptHandle: handle,
        promptVersionNumber: versionNumber,
        promptVersionId: versionId,
        promptTag: null,
        promptVariables: variables,
      };
    }
  }

  return nullResult;
}

function parseVersionNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const version = Number(raw);
  if (!Number.isInteger(version) || version <= 0) return null;
  return version;
}

/**
 * Parses prompt variables from span attributes.
 *
 * Two supported shapes:
 * 1. **Flat** (preferred): `langwatch.prompt.variables.<name> = <scalar>`.
 *    Each variable is its own attribute. Queryable as first-class span
 *    attributes via the existing metadata-key facet machinery.
 * 2. **Legacy JSON blob**: `langwatch.prompt.variables = '{"type":"json","value":{...}}'`.
 *
 * Both shapes are merged when present; flat keys take precedence on
 * collision because they're the newer convention.
 *
 * @param attrs - Span attributes record
 * @returns Record of variable names → string values, or null if neither shape is present.
 */
function parsePromptVariables(
  attrs: Record<string, unknown>,
): Record<string, string> | null {
  const fromBlob = parseVariablesBlob(attrs[ATTR_PROMPT_VARIABLES]);
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(ATTR_PROMPT_VARIABLES_PREFIX)) continue;
    const name = key.slice(ATTR_PROMPT_VARIABLES_PREFIX.length);
    if (!name) continue;
    flat[name] = String(value);
  }

  if (fromBlob === null && Object.keys(flat).length === 0) return null;
  return { ...(fromBlob ?? {}), ...flat };
}

function parseVariablesBlob(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("value" in parsed)) {
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
