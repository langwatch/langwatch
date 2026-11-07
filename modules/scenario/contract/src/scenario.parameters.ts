import type { Named } from "@langwatch/module";
import { z } from "zod";

export const MAX_SCENARIO_PARAMETER_DEFINITIONS = 20;
export const MAX_RUN_PARAMETER_KEYS = 50;
export const MAX_RUN_PARAMETER_BYTES = 16_384;
export const MAX_PARAMETER_VALUE_LENGTH = 4096;
export const MAX_PARAMETER_NAME_LENGTH = 64;
export const MAX_PARAMETER_DESCRIPTION_LENGTH = 500;

/** How many values a closed option list may hold. */
export const MAX_PARAMETER_OPTIONS = 50;

/** The value types a declaration can name. */
export const SCENARIO_PARAMETER_TYPES = ["string", "number", "boolean"] as const;
export type ScenarioParameterType = (typeof SCENARIO_PARAMETER_TYPES)[number];

export const SCENARIO_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const reservedParameterNames = new Set(["__proto__", "constructor", "prototype"]);

function isUsableParameterName(name: string): boolean {
  return SCENARIO_PARAMETER_NAME_PATTERN.test(name) && !reservedParameterNames.has(name);
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

/** What a secret parameter with a default value is refused with. */
export const SECRET_PARAMETER_DEFAULT_MESSAGE = "A secret parameter cannot carry a default value";

/** What a secret parameter with an option list is refused with. */
export const SECRET_PARAMETER_OPTIONS_MESSAGE = "A secret parameter cannot list options";

const scenarioParameterDefinitionSchemaDefinition = z
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
    /**
     * The value type. Absent on a declaration authored before types existed,
     * which reads as text. A connected agent declares it from the function's
     * own annotations.
     */
    type: z.enum(SCENARIO_PARAMETER_TYPES).optional(),
    /**
     * A closed list of the values the parameter accepts. A run that supplies a
     * value outside the list is refused before anything is scheduled.
     */
    options: z
      .array(parameterValueSchema)
      .max(MAX_PARAMETER_OPTIONS, `A parameter can list at most ${MAX_PARAMETER_OPTIONS} options`)
      .optional(),
    /**
     * Whether a run must supply a value. Declared by a connected agent whose
     * function has no default for the parameter; the SDK refuses a call that
     * carries none before the function runs.
     */
    required: z.boolean().optional(),
  })
  .strict();
export interface ScenarioParameterDefinitionSchema extends Named<
  typeof scenarioParameterDefinitionSchemaDefinition
> {}
export const scenarioParameterDefinitionSchema: ScenarioParameterDefinitionSchema =
  scenarioParameterDefinitionSchemaDefinition;
export type ScenarioParameterDefinition = z.infer<typeof scenarioParameterDefinitionSchema>;

const scenarioParameterDefinitionsSchemaDefinition = z
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
          message: SECRET_PARAMETER_DEFAULT_MESSAGE,
        });
      }
      // An option list on a secret parameter is the same fault as a default:
      // the credentials would sit in clear on the scenario row.
      if (definition.secret === true && definition.options !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "options"],
          message: SECRET_PARAMETER_OPTIONS_MESSAGE,
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
export interface ScenarioParameterDefinitionsSchema extends Named<
  typeof scenarioParameterDefinitionsSchemaDefinition
> {}
export const scenarioParameterDefinitionsSchema: ScenarioParameterDefinitionsSchema =
  scenarioParameterDefinitionsSchemaDefinition;

const runParameterKeySchema = z.string().refine((name) => !reservedParameterNames.has(name), {
  message: reservedNameMessage,
});

const runParameterValuesObjectSchema = z
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
  });

export const runParameterValuesSchema = z.preprocess<
  unknown,
  typeof runParameterValuesObjectSchema,
  z.input<typeof runParameterValuesObjectSchema>
>((value) => {
  if (value === null) return value;
  if (typeof value !== "object") return value;
  const names = Object.keys(value);
  const hasReservedName = names.some((name) => reservedParameterNames.has(name));
  if (hasReservedName) {
    return undefined;
  }
  return value;
}, runParameterValuesObjectSchema);
export type RunParameterValues = z.infer<typeof runParameterValuesSchema>;

/**
 * Reads parameter values back off the raw JSON a run stored them as.
 * Tolerant on purpose: an unrecognised value is dropped rather than failing
 * the whole read. A run that stored none, or predates the field, reads empty.
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
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[name] = value;
    }
  }
  return values;
}

export function parseScenarioParameterDefinitions(value: unknown): ScenarioParameterDefinition[] {
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
}): RunParameterValues {
  if (!values) return {};
  if (names.size === 0) return values;
  return Object.fromEntries(Object.entries(values).filter(([name]) => !names.has(name)));
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
    if (definition.defaultValue !== undefined && isUsableParameterName(definition.name)) {
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

// Inline run parameters: `{ key: value }` in a situation (ADR-180).

/** Single braces only: `{{ ... }}` around a declaration stays Liquid's to read. */
const INLINE_DECLARATION = /(?<!\{)\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:([^{}\n]*)\}(?!\})/g;

/** What the situation declares inline, and the text Liquid renders in its place. */
export type InlineRunParameters = {
  /** The situation with each declaration replaced by a `params` reference. */
  template: string;
  /** One definition per name, carrying the first default written for it. */
  definitions: ScenarioParameterDefinition[];
};

/** One declaration the reader accepted, and where it sits in the text. */
type InlineDeclarationMatch = {
  definition: ScenarioParameterDefinition;
  defaultValue: string;
  start: number;
  end: number;
};

/** The one reader of inline declarations: the run path and the editor both go through it. */
function readInlineDeclarations(text: string): {
  template: string;
  matches: InlineDeclarationMatch[];
} {
  const matches: InlineDeclarationMatch[] = [];
  let template = "";
  let at = 0;
  for (const match of text.matchAll(INLINE_DECLARATION)) {
    const [declaration, name = "", raw = ""] = match;
    const defaultValue = raw.trim();
    const parsed = scenarioParameterDefinitionSchema.safeParse({ name, defaultValue });
    if (!parsed.success || defaultValue === "") continue;
    const start = match.index;
    const end = start + declaration.length;
    matches.push({ definition: parsed.data, defaultValue, start, end });
    template += `${text.slice(at, start)}{{ params.${name} }}`;
    at = end;
  }
  template += text.slice(at);
  return { template, matches };
}

/**
 * Reads every `{ key: value }` declaration out of a situation. Each one
 * becomes `{{ params.key }}`, so the run's resolved value shows where the
 * declaration was. Anything that is not a valid declaration stays as text.
 */
export function extractInlineRunParameters({ text }: { text: string }): InlineRunParameters {
  const { template, matches } = readInlineDeclarations(text);
  const byName = new Map<string, ScenarioParameterDefinition>();
  for (const { definition } of matches) {
    if (!byName.has(definition.name)) byName.set(definition.name, definition);
  }
  return { template, definitions: [...byName.values()] };
}

/** How a run reads one inline declaration, given what else the scenario declares. */
export type InlineDeclarationStatus =
  | { kind: "declared" }
  /** The name was declared earlier with another default, which is the one used. */
  | { kind: "duplicate"; usedDefault: string }
  /** A stored parameter has the name; its declaration wins. */
  | { kind: "stored"; storedDefault: ScenarioParameterValue | undefined }
  /** A stored secret has the name; the run refuses it (`scenario_secret_parameter_in_text`). */
  | { kind: "secret" };

/** One inline declaration in a situation: its place in the text and how a run reads it. */
export type InlineDeclaration = {
  name: string;
  defaultValue: string;
  start: number;
  end: number;
  status: InlineDeclarationStatus;
};

/**
 * Every inline declaration in a situation, in order, each with its conflict
 * against the stored parameters or an earlier declaration of the same name.
 * Same reader as `extractInlineRunParameters`: what an editor marks, a run declares.
 */
export function inlineDeclarationsOf({
  text,
  parameters,
}: {
  text: string;
  /** The scenario's stored parameters, secrets included. */
  parameters: readonly ScenarioParameterDefinition[];
}): InlineDeclaration[] {
  const stored = new Map(parameters.map((definition) => [definition.name, definition]));
  const firstDefaults = new Map<string, string>();
  return readInlineDeclarations(text).matches.map(({ definition, defaultValue, start, end }) => {
    const { name } = definition;
    const first = firstDefaults.get(name);
    if (first === undefined) firstDefaults.set(name, defaultValue);
    return {
      name,
      defaultValue,
      start,
      end,
      status: inlineStatus({ stored: stored.get(name), first, defaultValue }),
    };
  });
}

/** A stored secret outranks a stored parameter, which outranks an earlier inline default. */
function inlineStatus({
  stored,
  first,
  defaultValue,
}: {
  stored: ScenarioParameterDefinition | undefined;
  first: string | undefined;
  defaultValue: string;
}): InlineDeclarationStatus {
  if (stored?.secret === true) return { kind: "secret" };
  if (stored) return { kind: "stored", storedDefault: stored.defaultValue };
  if (first !== undefined && first !== defaultValue) {
    return { kind: "duplicate", usedDefault: first };
  }
  return { kind: "declared" };
}

/**
 * The parameters a scenario declares, stored and inline, and the situation
 * to render. A stored declaration wins over an inline one of the same name,
 * so a secret never gains a default from the text.
 */
export function declaredScenarioParameters({
  parameters,
  situation,
}: {
  parameters: unknown;
  situation: string;
}): { definitions: ScenarioParameterDefinition[]; situation: string } {
  const stored = parseScenarioParameterDefinitions(parameters);
  const inline = extractInlineRunParameters({ text: situation });
  const storedNames = new Set(stored.map((definition) => definition.name));
  return {
    definitions: [
      ...stored,
      ...inline.definitions.filter((definition) => !storedNames.has(definition.name)),
    ],
    situation: inline.template,
  };
}
