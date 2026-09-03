import { z } from "zod";
import { parsePromptShorthand } from "./prompt.shorthand";

/**
 * Prompt metadata reconstructed from SDK span attributes.
 *
 * This is deliberately distinct from the service's `PromptReference`: it is
 * observational data and can be incomplete when an SDK emitted only part of
 * the Prompt metadata.
 */
export type ParsedPromptTraceReference = {
  promptHandle: string | null;
  promptVersionNumber: number | null;
  promptVersionId: string | null;
  promptTag: string | null;
  promptVariables: Record<string, string> | null;
};

const promptIdAttribute = "langwatch.prompt.id";
const promptHandleAttribute = "langwatch.prompt.handle";
const promptVersionNumberAttribute = "langwatch.prompt.version.number";
const promptVersionIdAttribute = "langwatch.prompt.version.id";
const promptVariablesAttribute = "langwatch.prompt.variables";
const promptVariablesPrefix = "langwatch.prompt.variables.";
const promptVariablesEnvelopeSchema = z.object({
  value: z.record(z.string(), z.unknown()),
});

/**
 * Parses the current flat SDK attributes, combined `handle:version` or
 * `handle:tag` shorthand, and the legacy separated attribute format.
 */
export function parsePromptTraceReference(
  attrs: Record<string, unknown>,
): ParsedPromptTraceReference {
  const variables = parsePromptVariables(attrs);
  const versionIdRaw = attrs[promptVersionIdAttribute];
  const promptVersionId =
    typeof versionIdRaw === "string" && versionIdRaw.length > 0 ? versionIdRaw : null;
  const empty: ParsedPromptTraceReference = {
    promptHandle: null,
    promptVersionNumber: null,
    promptVersionId,
    promptTag: null,
    promptVariables: variables,
  };
  const promptId = attrs[promptIdAttribute];

  if (typeof promptId === "string" && promptId.includes(":")) {
    try {
      const shorthand = parsePromptShorthand(promptId);
      return {
        promptHandle: shorthand.slug,
        promptVersionNumber: shorthand.version ?? null,
        promptVersionId,
        promptTag: shorthand.tag ?? null,
        promptVariables: variables,
      };
    } catch {
      return empty;
    }
  }

  if (typeof promptId === "string" && promptId.length > 0) {
    const handle = attrs[promptHandleAttribute];
    return {
      promptHandle: typeof handle === "string" && handle.length > 0 ? handle : promptId,
      promptVersionNumber: parseVersionNumber(attrs[promptVersionNumberAttribute]),
      promptVersionId,
      promptTag: null,
      promptVariables: variables,
    };
  }

  const handle = attrs[promptHandleAttribute];
  if (typeof handle === "string" && handle.length > 0) {
    const promptVersionNumber = parseVersionNumber(attrs[promptVersionNumberAttribute]);
    if (promptVersionNumber !== null) {
      return { ...empty, promptHandle: handle, promptVersionNumber };
    }
  }

  return empty;
}

function parseVersionNumber(raw: unknown): number | null {
  const version = Number(raw);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function parsePromptVariables(attrs: Record<string, unknown>): Record<string, string> | null {
  const fromBlob = parseVariablesBlob(attrs[promptVariablesAttribute]);
  const flat: Record<string, string> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(promptVariablesPrefix)) {
      continue;
    }

    const name = key.slice(promptVariablesPrefix.length);

    if (name) {
      flat[name] = String(value);
    }
  }

  return fromBlob === null && Object.keys(flat).length === 0
    ? null
    : { ...(fromBlob ?? {}), ...flat };
}

function parseVariablesBlob(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = promptVariablesEnvelopeSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(parsed.data.value).map(([key, entry]) => [key, stringifyVariableValue(entry)]),
    );
  } catch {
    return null;
  }
}

function stringifyVariableValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === void 0) {
    return String(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
