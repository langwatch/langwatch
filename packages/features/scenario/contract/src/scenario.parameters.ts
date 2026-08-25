import { z } from "zod";

export const MAX_SCENARIO_PARAMETER_DEFINITIONS = 20;
export const MAX_RUN_PARAMETER_KEYS = 50;
export const MAX_RUN_PARAMETER_BYTES = 16_384;
export const MAX_PARAMETER_VALUE_LENGTH = 4096;
export const MAX_PARAMETER_NAME_LENGTH = 64;
export const MAX_PARAMETER_DESCRIPTION_LENGTH = 500;
export const SCENARIO_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const reservedParameterNames = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function isUsableParameterName(name: string): boolean {
  return (
    SCENARIO_PARAMETER_NAME_PATTERN.test(name) &&
    !reservedParameterNames.has(name)
  );
}
const parameterNameMessage =
  "Parameter names start with a letter or underscore and may contain only letters, digits and underscores";
const reservedNameMessage = `Parameter names cannot be ${[...reservedParameterNames].join(", ")}`;

const parameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  z.number(),
  z.boolean(),
]);
export type ScenarioParameterValue = z.infer<typeof parameterValueSchema>;

export const scenarioParameterDefinitionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(MAX_PARAMETER_NAME_LENGTH)
      .regex(SCENARIO_PARAMETER_NAME_PATTERN, parameterNameMessage)
      .refine((name) => !reservedParameterNames.has(name), {
        message: reservedNameMessage,
      }),
    description: z.string().max(MAX_PARAMETER_DESCRIPTION_LENGTH).optional(),
    defaultValue: parameterValueSchema.optional(),
    secret: z.boolean().optional(),
  })
  .strict();
export type ScenarioParameterDefinition = z.infer<
  typeof scenarioParameterDefinitionSchema
>;

export const scenarioParameterDefinitionsSchema = z
  .array(scenarioParameterDefinitionSchema)
  .max(
    MAX_SCENARIO_PARAMETER_DEFINITIONS,
    `A scenario can declare at most ${MAX_SCENARIO_PARAMETER_DEFINITIONS} parameters`,
  )
  .superRefine((definitions, context) => {
    const names = new Set<string>();
    for (const [index, definition] of definitions.entries()) {
      if (definition.secret === true && definition.defaultValue !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "defaultValue"],
          message: "A secret parameter cannot carry a default value",
        });
      }
      if (names.has(definition.name)) {
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: `Duplicate parameter name "${definition.name}"`,
        });
      }
      names.add(definition.name);
    }
  });

const runParameterKeySchema = z
  .string()
  .refine((name) => !reservedParameterNames.has(name), {
    message: reservedNameMessage,
  });

export const runParameterValuesSchema = z.preprocess(
  (value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).some((name) => reservedParameterNames.has(name))
    ) {
      return undefined;
    }
    return value;
  },
  z
    .record(runParameterKeySchema, parameterValueSchema)
  .superRefine((values, context) => {
    const names = Object.keys(values);
    for (const name of names) {
      if (!SCENARIO_PARAMETER_NAME_PATTERN.test(name)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: parameterNameMessage,
        });
      }
    }
    if (names.length > MAX_RUN_PARAMETER_KEYS) {
      context.addIssue({
        code: "custom",
        message: `A run can supply at most ${MAX_RUN_PARAMETER_KEYS} parameter values`,
      });
    }
    if (new TextEncoder().encode(JSON.stringify(values)).length > MAX_RUN_PARAMETER_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Parameter values are limited to ${MAX_RUN_PARAMETER_BYTES} bytes in total`,
      });
    }
    }),
);
export type RunParameterValues = z.infer<typeof runParameterValuesSchema>;

export function parseScenarioParameterDefinitions(
  value: unknown,
): ScenarioParameterDefinition[] {
  if (value === null || value === undefined) return [];
  const parsed = scenarioParameterDefinitionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Splits parameters that render into scenario text from run-only secrets. */
export function partitionParameterDefinitions(
  definitions: readonly ScenarioParameterDefinition[],
): {
  plain: ScenarioParameterDefinition[];
  secret: ScenarioParameterDefinition[];
} {
  const plain: ScenarioParameterDefinition[] = [];
  const secret: ScenarioParameterDefinition[] = [];
  for (const definition of definitions) {
    if (definition.secret === true) secret.push(definition);
    else plain.push(definition);
  }
  return { plain, secret };
}

/** Returns a value record without the supplied names. */
export function withoutParameterNames({
  values,
  names,
}: {
  values?: RunParameterValues;
  names: ReadonlySet<string>;
}): RunParameterValues | undefined {
  if (!values || names.size === 0) return values;
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => !names.has(name)),
  );
}

/** Resolves declared defaults, overridden by caller-provided values. */
export function mergeRunParameters({
  definitions,
  values,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): RunParameterValues {
  const resolved = new Map<string, ScenarioParameterValue>();
  for (const definition of definitions) {
    if (
      definition.defaultValue !== undefined &&
      isUsableParameterName(definition.name)
    ) {
      resolved.set(definition.name, definition.defaultValue);
    }
  }
  for (const [name, value] of Object.entries(values ?? {})) {
    if (isUsableParameterName(name)) resolved.set(name, value);
  }
  return Object.fromEntries(resolved);
}

/** Lists supplied names that no scenario in a run declares. */
export function findUnknownParameterKeys({
  declaredNames,
  values,
}: {
  declaredNames: Iterable<string>;
  values: RunParameterValues;
}): string[] {
  const declared = new Set(declaredNames);
  return Object.keys(values).filter((name) => !declared.has(name));
}
