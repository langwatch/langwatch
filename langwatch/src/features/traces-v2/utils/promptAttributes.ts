/**
 * Parsing helpers for the `langwatch.prompt.*` span attributes that the
 * LangWatch SDKs emit when a managed prompt is used. Shared between the
 * span-level Prompt accordion and the trace-level prompt aggregation that
 * powers the header chip + Prompts tab.
 */

const PROMPT_PREFIX = "langwatch.prompt.";

export interface PromptReference {
  /** Slug / handle of the managed prompt template. */
  handle: string;
  /** Numeric version (e.g. 4 for v4) — null when only a tag is known. */
  versionNumber: number | null;
  /** Named tag like "production" or "latest" — null when a specific version was used. */
  tag: string | null;
  /** Variable values that were filled into the template, sorted-friendly. */
  variables: Record<string, string> | null;
}

export function hasPromptMetadata(
  params: Record<string, unknown> | null | undefined,
): boolean {
  if (!params) return false;
  return Object.keys(params).some((key) => key.startsWith(PROMPT_PREFIX));
}

/**
 * Parses a single `"handle:version_or_tag"` shorthand (the format used in
 * the trace-level `langwatch.prompt_ids` array). Returns null when the
 * string isn't a usable reference.
 */
export function parsePromptIdString(raw: string): PromptReference | null {
  if (!raw.includes(":")) return null;

  const colonIndex = raw.lastIndexOf(":");
  const slug = raw.substring(0, colonIndex);
  const suffix = raw.substring(colonIndex + 1);
  if (slug.length === 0) return null;

  if (suffix.length === 0 || suffix === "latest") {
    return { handle: slug, versionNumber: null, tag: null, variables: null };
  }

  const parsed = Number(suffix);
  if (Number.isInteger(parsed) && parsed > 0) {
    return { handle: slug, versionNumber: parsed, tag: null, variables: null };
  }
  return { handle: slug, versionNumber: null, tag: suffix, variables: null };
}

/**
 * Reads + parses the trace-level `langwatch.prompt_ids` attribute set by
 * the trace-summary projection. Each entry is a `"handle:version_or_tag"`
 * shorthand — variables are not part of this aggregation, only references.
 */
export function parseTracePromptIds(
  attributes: Record<string, string> | null | undefined,
): PromptReference[] {
  if (!attributes) return [];
  const raw = attributes["langwatch.prompt_ids"];
  if (typeof raw !== "string" || raw.length === 0) return [];

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const result: PromptReference[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const ref = parsePromptIdString(entry);
    if (!ref) continue;
    const key = promptReferenceKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * Parses prompt reference data from flat span attributes.
 *
 * Supports two formats:
 * 1. Combined: `langwatch.prompt.id = "handle:version_or_tag"`
 * 2. Separate: `langwatch.prompt.handle` + `langwatch.prompt.version.number`
 *
 * Variables use a wrapped JSON format: `{"type":"json","value":{"key":"val"}}`.
 * Returns null when no usable handle is present.
 */
export function extractPromptReference(
  params: Record<string, unknown> | null | undefined,
): PromptReference | null {
  if (!params) return null;

  const variables = parsePromptVariables(params);

  const promptId = params["langwatch.prompt.id"];
  if (typeof promptId === "string" && promptId.includes(":")) {
    const colonIndex = promptId.lastIndexOf(":");
    const slug = promptId.substring(0, colonIndex);
    const suffix = promptId.substring(colonIndex + 1);

    if (slug.length > 0 && suffix.length > 0 && suffix !== "latest") {
      const parsed = Number(suffix);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { handle: slug, versionNumber: parsed, tag: null, variables };
      }
      return { handle: slug, versionNumber: null, tag: suffix, variables };
    }

    if (slug.length > 0) {
      return { handle: slug, versionNumber: null, tag: null, variables };
    }
  }

  const handle = params["langwatch.prompt.handle"];
  const versionRaw = params["langwatch.prompt.version.number"];

  if (typeof handle === "string" && handle.length > 0) {
    if (versionRaw != null) {
      const version = Number(versionRaw);
      if (Number.isInteger(version) && version > 0) {
        return { handle, versionNumber: version, tag: null, variables };
      }
    }
    return { handle, versionNumber: null, tag: null, variables };
  }

  return null;
}

function parsePromptVariables(
  params: Record<string, unknown>,
): Record<string, string> | null {
  const raw = params["langwatch.prompt.variables"];
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

/**
 * Stable key for grouping spans that share the same prompt + version. The
 * tag is part of the key because two spans calling `prompt:production` may
 * have hit different underlying versions over time, but at the trace level
 * we display the tag the user wrote.
 */
export function promptReferenceKey(ref: PromptReference): string {
  return `${ref.handle}@${ref.versionNumber ?? ""}#${ref.tag ?? ""}`;
}

/**
 * Compact label for a prompt reference, e.g. `"refund-policy v4"`,
 * `"refund-policy production"`, or just `"refund-policy"`.
 */
export function formatPromptReferenceLabel(ref: PromptReference): string {
  if (ref.versionNumber != null) {
    return `${ref.handle} v${ref.versionNumber}`;
  }
  if (ref.tag) {
    return `${ref.handle} ${ref.tag}`;
  }
  return ref.handle;
}
