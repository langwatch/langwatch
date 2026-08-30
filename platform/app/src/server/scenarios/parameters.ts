/**
 * Scenario run parameters: the names a scenario declares, and the values a run
 * resolves for them.
 *
 * A scenario owner declares parameters by name so the same scenario can be run
 * against another account, tenant or region without rewriting it. Whoever
 * starts the run supplies values for those names; a supplied value wins over
 * the declared default. The resolved record is handed to the target under test
 * and is what the scenario's own situation and criteria read as `params.NAME`.
 *
 * A parameter can also be declared secret. A secret parameter carries no
 * default, its value is supplied when the run starts, and it is delivered to
 * the target under test through the `secrets` namespace instead of `params`.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { z } from "zod";

/** How many parameters one scenario may declare. */
export const MAX_SCENARIO_PARAMETER_DEFINITIONS = 20;

/** How many names one run may supply values for. */
export const MAX_RUN_PARAMETER_KEYS = 50;

/**
 * How large a run's parameter values may be once serialised, in bytes. The
 * values travel on every job in the batch, so the cap is on the payload as a
 * whole rather than on any single value.
 */
export const MAX_RUN_PARAMETER_BYTES = 16_384;

/** How long a single string value may be. */
export const MAX_PARAMETER_VALUE_LENGTH = 4096;

/** How long a parameter name may be. */
export const MAX_PARAMETER_NAME_LENGTH = 64;

/** How long a parameter's description may be. */
export const MAX_PARAMETER_DESCRIPTION_LENGTH = 500;

/**
 * The grammar a parameter name must satisfy.
 *
 * Names are read back as `params.NAME` from templates and as an input key by
 * targets, so they are restricted to what both surfaces can address without
 * quoting: a leading letter or underscore, then letters, digits and
 * underscores.
 */
export const SCENARIO_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names the grammar allows but a JavaScript object treats as something other
 * than an ordinary key.
 *
 * The resolved values are a plain record, so `__proto__` reaches the prototype
 * setter rather than becoming an own key, and whether a value survives would
 * otherwise depend on which side of the merge it arrived from. Refusing the
 * three names keeps one behavior for every name a caller can write.
 */
const RESERVED_PARAMETER_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const PARAMETER_NAME_MESSAGE =
  "Parameter names start with a letter or underscore and may contain only letters, digits and underscores";

const RESERVED_NAME_MESSAGE = `Parameter names cannot be ${[...RESERVED_PARAMETER_NAMES].join(", ")}`;

/** Whether `name` is a name a run may address. */
function isUsableParameterName(name: string): boolean {
  return (
    SCENARIO_PARAMETER_NAME_PATTERN.test(name) &&
    !RESERVED_PARAMETER_NAMES.has(name)
  );
}

const parameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  z.number(),
  z.boolean(),
]);

/** What a secret parameter with a default value is refused with. */
export const SECRET_PARAMETER_DEFAULT_MESSAGE =
  "A secret parameter cannot carry a default value";

/** One declared parameter, as authored on the scenario. */
export const scenarioParameterDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_PARAMETER_NAME_LENGTH)
    .regex(SCENARIO_PARAMETER_NAME_PATTERN, PARAMETER_NAME_MESSAGE)
    .refine((name) => !RESERVED_PARAMETER_NAMES.has(name), {
      message: RESERVED_NAME_MESSAGE,
    }),
  description: z.string().max(MAX_PARAMETER_DESCRIPTION_LENGTH).optional(),
  defaultValue: parameterValueSchema
    .optional()
    .describe(
      "The value the run uses when it supplies none. A secret parameter cannot carry one.",
    ),
  /**
   * Whether the value is a credential. A secret value is supplied per run,
   * encrypted before it is recorded, and read by the target as
   * `secrets.NAME` rather than `params.NAME`.
   */
  secret: z
    .boolean()
    .optional()
    .describe(
      "Whether the value is a credential, supplied when the run starts and delivered to the target as secrets.NAME. A secret parameter is rejected when it also carries defaultValue.",
    ),
});

/**
 * Every parameter one scenario declares.
 *
 * Duplicate names are rejected rather than last-one-wins: the resolved record
 * is keyed by name, so two declarations of the same name mean one of them is
 * dead configuration the author cannot see.
 */
export const scenarioParameterDefinitionsSchema = z
  .array(scenarioParameterDefinitionSchema)
  .max(
    MAX_SCENARIO_PARAMETER_DEFINITIONS,
    `A scenario can declare at most ${MAX_SCENARIO_PARAMETER_DEFINITIONS} parameters`,
  )
  .superRefine((definitions, ctx) => {
    const seen = new Set<string>();
    definitions.forEach((definition, index) => {
      // A default on a secret parameter is a credential typed into the
      // scenario itself: stored in clear on the scenario row, and readable by
      // everyone who can open the scenario. The declaration is refused rather
      // than quietly ignored.
      if (definition.secret === true && definition.defaultValue !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "defaultValue"],
          message: SECRET_PARAMETER_DEFAULT_MESSAGE,
        });
      }
      if (seen.has(definition.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "name"],
          message: `Duplicate parameter name "${definition.name}"`,
        });
        return;
      }
      seen.add(definition.name);
    });
  });

/**
 * The key schema, which carries the reserved-name check and nothing else.
 *
 * It has to run here rather than in the refinement below. Zod drops a
 * `__proto__` key while it builds the record, so the refinement never sees
 * one, and the caller got a success for a value the run then ignored. The key
 * schema runs first, so the name is refused the same way every other bad name
 * is refused.
 */
const runParameterKeySchema = z
  .string()
  .refine((name) => !RESERVED_PARAMETER_NAMES.has(name), {
    message: RESERVED_NAME_MESSAGE,
  });

/**
 * The values a run supplies, keyed by parameter name.
 *
 * The name grammar is checked in a refinement rather than in the key schema so
 * a bad name is reported against the key that carries it, and so the size caps
 * can read the record as a whole.
 */
export const runParameterValuesSchema = z
  .record(runParameterKeySchema, parameterValueSchema)
  .superRefine((values, ctx) => {
    const names = Object.keys(values);

    for (const name of names) {
      if (!SCENARIO_PARAMETER_NAME_PATTERN.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: PARAMETER_NAME_MESSAGE,
        });
      }
    }

    if (names.length > MAX_RUN_PARAMETER_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A run can supply at most ${MAX_RUN_PARAMETER_KEYS} parameter values`,
      });
    }

    const byteLength = new TextEncoder().encode(JSON.stringify(values)).length;
    if (byteLength > MAX_RUN_PARAMETER_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Parameter values are limited to ${MAX_RUN_PARAMETER_BYTES} bytes in total`,
      });
    }
  });

export type ScenarioParameterValue = z.infer<typeof parameterValueSchema>;
export type ScenarioParameterDefinition = z.infer<
  typeof scenarioParameterDefinitionSchema
>;
export type RunParameterValues = z.infer<typeof runParameterValuesSchema>;

/**
 * Reads parameter values back off the raw JSON a run stored them as.
 *
 * Tolerant on purpose: a value the current shape does not understand is
 * dropped rather than taking the whole read down, the same way a stored scope
 * that no longer parses still runs. A run that stored none reads as the empty
 * string, and so does a run recorded before the field existed.
 */
export function parseRunParametersJson(raw: string): RunParameterValues {
  if (raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const values: RunParameterValues = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      values[name] = value;
    }
  }
  return values;
}

/**
 * Reads the declarations off a scenario's stored JSON column.
 *
 * Tolerant on purpose: a scenario whose column holds a shape this version does
 * not understand still runs, it just runs with no parameters, which is the
 * same path a scenario that never declared any takes. Rejecting the whole
 * scenario here would take a run down for a column nothing in it references.
 */
export function parseScenarioParameterDefinitions(
  json: unknown,
): ScenarioParameterDefinition[] {
  if (json === null || json === undefined) return [];
  const parsed = scenarioParameterDefinitionsSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

/**
 * Splits declarations into the ones the run merges into `params` and the ones
 * it delivers through `secrets`.
 *
 * The split runs before anything merges a value, so a secret value never
 * enters the record that renders the scenario's text or reaches the child's
 * `params` namespace.
 */
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

/** The supplied values with the given names taken out of them. */
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

/**
 * Resolves the values a run uses: every declared default, overridden by
 * whatever the run supplied for that name.
 */
export function mergeRunParameters({
  definitions,
  values,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): RunParameterValues {
  // Built through a Map rather than by assigning onto an object literal. The
  // schema refuses the names that would not become own keys, but a scenario
  // stored before that guard can still hold one, and assignment would send it
  // to the prototype setter instead of dropping it where it can be seen.
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

/**
 * The supplied names no scenario in the run declares.
 *
 * A run covers several scenarios, so a name is unknown only when none of them
 * declares it. Order follows the supplied record so the rejection reads back
 * in the order the caller wrote.
 */
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
