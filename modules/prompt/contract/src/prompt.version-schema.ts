import { z } from "zod";

import { SchemaVersion, sortKeysDeep } from "./prompt.enums.ts";
import {
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
  versionSchema,
  nodeDatasetSchema,
  nulFreeStringSchema,
} from "./prompt.field-schemas.ts";

export const LATEST_SCHEMA_VERSION = SchemaVersion.V1_0 as const;

/**
 * Schema v1.0 - Base configuration schema
 * Validates the configData JSON field in LlmPromptConfigVersion
 */
const configSchemaV1_0 = z.object({
  id: z.string(),
  authorId: z.string().nullable().optional(),
  author: z
    .object({
      id: z.string(),
      // name is nullable: many SSO/OAuth providers return a profile with no
      // display name, and the User.name column is nullable. Requiring a string
      // here made the version-history read path throw for name-less authors.
      name: z.string().nullable(),
      email: z.string().nullable().optional(),
      image: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  projectId: z.string().min(1, "Project ID cannot be empty"),
  configId: z.string().min(1, "Config ID cannot be empty"),
  schemaVersion: z.literal(SchemaVersion.V1_0),
  commitMessage: nulFreeStringSchema,
  version: versionSchema,
  createdAt: z.date(),
  configData: z.object({
    prompt: nulFreeStringSchema,
    messages: z.array(messageSchema).default([]),
    inputs: z.array(inputsSchema).default([]),
    outputs: z.array(outputsSchema).min(1, "At least one output is required"),
    model: nulFreeStringSchema.min(1, "Model identifier cannot be empty"),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    // Traditional sampling parameters
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    // Other sampling parameters
    seed: z.number().optional(),
    top_k: z.number().optional(),
    min_p: z.number().optional(),
    repetition_penalty: z.number().optional(),
    // Reasoning parameter (canonical/unified field)
    // Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)
    reasoning: z.string().optional(),
    // Provider-specific fields - kept for backward compatibility reading old data
    // New data should only use 'reasoning' field
    reasoning_effort: z.string().optional(), // OpenAI (legacy)
    thinkingLevel: z.string().optional(), // Gemini (legacy)
    effort: z.string().optional(), // Anthropic (legacy)
    verbosity: z.string().optional(),
    demonstrations: nodeDatasetSchema.optional(),
    prompting_technique: promptingTechniqueSchema.optional(),
    // Deprecated: response_format is now derived from outputs at read time.
    // Kept optional for backward compat reading old data, but never written for new data.
    response_format: responseFormatSchema.optional(),
  }),
});

/**
 * Map of schema validators by version
 * Used to validate the configData field in LlmPromptConfigVersion
 */
export const schemaValidators = {
  [SchemaVersion.V1_0]: configSchemaV1_0,
};

export function getSchemaValidator(version: SchemaVersion | string): typeof configSchemaV1_0 {
  const validator = schemaValidators[version as SchemaVersion];
  if (!validator) {
    throw new Error(`Unknown schema version: ${version}`);
  }
  return validator;
}

export type LatestConfigVersionSchema = z.infer<typeof configSchemaV1_0>;

/**
 * Returns the latest schema version for LlmPromptConfigVersion
 */
export function getLatestConfigVersionSchema(): typeof configSchemaV1_0 {
  return configSchemaV1_0;
}

export function getVersionValidator(schemaVersion: SchemaVersion): typeof configSchemaV1_0 {
  return schemaValidators[schemaVersion];
}

/**
 * Parses configuration data against a specific schema version
 * Used to validate configData in LlmPromptConfigVersion before saving
 * @param llmConfigVersion - The configuration data to parse
 * @returns The parsed config data
 * @throws Error if the schema llmConfigVersion is unknown
 * @throws ZodError if the config data is invalid
 */
export function parseLlmConfigVersion(
  llmConfigVersion: {
    schemaVersion: SchemaVersion | string;
  },
  options?: { onLegacyPromptingTechnique?: (change: LegacyPromptingTechniqueChange) => void },
): LatestConfigVersionSchema {
  const { schemaVersion } = llmConfigVersion;

  const validator = getVersionValidator(schemaVersion as SchemaVersion);

  if (!validator) {
    throw new Error(`Unknown schema llmConfigVersion: ${schemaVersion}`);
  }

  // Read path only: stored data may predate the strict enum. Writes validate
  // with the strict validator directly and never go through this function.
  const configData = (llmConfigVersion as { configData?: unknown }).configData;
  if (configData && typeof configData === "object" && !Array.isArray(configData)) {
    const { configData: normalized, change } = normalizeLegacyPromptingTechnique(
      configData as Record<string, unknown>,
    );
    if (change) {
      options?.onLegacyPromptingTechnique?.(change);
      return validator.parse({ ...llmConfigVersion, configData: normalized });
    }
  }

  return validator.parse(llmConfigVersion);
}

type PromptingTechniqueType = "few_shot" | "in_context" | "chain_of_thought";

export interface LegacyPromptingTechniqueChange {
  /** Shape of the stored value, never its content (e.g. "string", "null", "object"). */
  storedShape: string;
  action: "mapped" | "dropped";
  mappedTo?: PromptingTechniqueType;
}

const TECHNIQUE_ALIASES: Record<string, PromptingTechniqueType> = {
  fewshot: "few_shot",
  incontext: "in_context",
  incontextlearning: "in_context",
  chainofthought: "chain_of_thought",
  cot: "chain_of_thought",
};

function mapLegacyTechniqueType(raw: unknown): PromptingTechniqueType | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return TECHNIQUE_ALIASES[key];
}

/**
 * Normalises legacy stored `prompting_technique` values (other spellings, a bare
 * string, null, unknown types) to the strict shape. No equivalent: dropped.
 */
export function normalizeLegacyPromptingTechnique(configData: Record<string, unknown>): {
  configData: Record<string, unknown>;
  change?: LegacyPromptingTechniqueChange;
} {
  if (!("prompting_technique" in configData)) return { configData };
  const stored = configData.prompting_technique;
  if (stored === undefined) return { configData };

  const { prompting_technique: _omit, ...rest } = configData;
  const drop = (storedShape: string) => ({
    configData: rest,
    change: { storedShape, action: "dropped" as const },
  });

  if (stored === null) return drop("null");

  if (typeof stored === "string") {
    const mapped = mapLegacyTechniqueType(stored);
    return mapped
      ? {
          configData: { ...rest, prompting_technique: { type: mapped } },
          change: { storedShape: "string", action: "mapped", mappedTo: mapped },
        }
      : drop("string");
  }

  if (typeof stored !== "object" || Array.isArray(stored)) {
    return drop(Array.isArray(stored) ? "array" : typeof stored);
  }

  const technique = stored as Record<string, unknown>;
  if (promptingTechniqueSchema.validate(technique)) return { configData };

  const mapped = mapLegacyTechniqueType(technique.type);
  if (!mapped) return drop("object");
  const candidate = { ...technique, type: mapped };
  // If the demonstrations are malformed too, keep the technique and drop them.
  const value = promptingTechniqueSchema.validate(candidate) ? candidate : { type: mapped };
  return {
    configData: { ...rest, prompting_technique: value },
    change: { storedShape: "object", action: "mapped", mappedTo: mapped },
  };
}

export type RuntimeParameters = Record<string, unknown>;

export function parseRuntimeParameters(value: unknown): RuntimeParameters {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as RuntimeParameters;
  }
  return {};
}

export function runtimeParametersEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeysDeep(a ?? {})) === JSON.stringify(sortKeysDeep(b ?? {}));
}

/**
 * Renders a single side of a runtime parameter diff. A key absent from the
 * object ("unset") must read differently from one explicitly set to
 * `undefined`, since `JSON.stringify(undefined)` can't tell them apart.
 */
function describeRuntimeParamValue(hasKey: boolean, value: unknown): string {
  if (!hasKey) return "unset";
  return value === undefined ? "undefined" : JSON.stringify(value);
}

/**
 * Per-key description of parameters differing between `localParameters` and
 * `remoteParameters`. Canonicalizes with `sortKeysDeep` so key reordering
 * alone isn't a change, and a missing key differs from an explicit `undefined`.
 */
export function diffRuntimeParameters({
  localParameters,
  remoteParameters,
}: {
  localParameters: unknown;
  remoteParameters: unknown;
}): string[] {
  const paramsA = (localParameters ?? {}) as RuntimeParameters;
  const paramsB = (remoteParameters ?? {}) as RuntimeParameters;
  const keys = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);

  const differences: string[] = [];
  for (const key of keys) {
    const hasA = key in paramsA;
    const hasB = key in paramsB;
    const equal =
      hasA === hasB &&
      JSON.stringify(sortKeysDeep(paramsA[key])) === JSON.stringify(sortKeysDeep(paramsB[key]));

    if (!equal) {
      differences.push(
        `${key}: ${describeRuntimeParamValue(hasA, paramsA[key])} → ${describeRuntimeParamValue(hasB, paramsB[key])}`,
      );
    }
  }
  return differences;
}

export function isValidHandle(handle: string): boolean {
  // npm package name pattern: allows lowercase letters, numbers, hyphens, and optionally one slash
  const npmPackagePattern = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/;
  const nanoIdPattern = /^prompt_[a-zA-Z0-9_-]+$/;
  return npmPackagePattern.test(handle) || nanoIdPattern.test(handle);
}
