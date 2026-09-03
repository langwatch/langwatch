/**
 * Suite fields: the typed columns a test suite declares beyond situation and
 * criteria, and the value a scenario carries for each of them.
 *
 * A test suite reads like a dataset. The suite declares the fields
 * (`expected_tools`, `golden_sql`, `table_schema`), every scenario filed in it
 * carries one value per field, and an evaluator attached to the suite reads
 * those values through its mappings. A blank value is "no value": the
 * evaluator that reads it is skipped for that scenario, with a reason.
 *
 * Framework-free on purpose: the client, the domain and the run worker all
 * import it.
 *
 * @see specs/scenarios/scenario-fields.feature
 * @see specs/suites/test-suites.feature
 */

import { z } from "zod";

/** The value types a field can hold. */
export const SUITE_FIELD_TYPES = ["text", "number", "boolean"] as const;
export type SuiteFieldType = (typeof SUITE_FIELD_TYPES)[number];

/** How many fields one suite may declare. */
export const MAX_SUITE_FIELDS = 30;

/** How long a field identifier may be. */
export const MAX_SUITE_FIELD_IDENTIFIER_LENGTH = 64;

/** How long one text value may be. */
export const MAX_SUITE_FIELD_TEXT_LENGTH = 65_536;

/**
 * The grammar an identifier must satisfy: a lowercase letter, then lowercase
 * letters, digits and underscores. It is read back as a mapping path segment
 * and as a key on the wire, so it stays addressable without quoting.
 */
export const SUITE_FIELD_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Names a scenario already answers to on its own. A field with one of these
 * would be a second answer to the same question.
 */
export const RESERVED_FIELD_IDENTIFIERS = [
  "situation",
  "criteria",
  "name",
  "input",
  "output",
] as const;

export const SUITE_FIELD_IDENTIFIER_MESSAGE =
  "Field identifiers start with a lowercase letter and may contain only lowercase letters, digits and underscores";

export const SUITE_FIELD_IDENTIFIER_RESERVED_MESSAGE = `Field identifiers cannot be ${RESERVED_FIELD_IDENTIFIERS.join(", ")}`;

export const SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE =
  "Two fields cannot share an identifier";

/** One field a suite declares. */
export const suiteFieldDefinitionSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .max(MAX_SUITE_FIELD_IDENTIFIER_LENGTH)
    .regex(SUITE_FIELD_IDENTIFIER_PATTERN, SUITE_FIELD_IDENTIFIER_MESSAGE)
    .refine(
      (identifier) =>
        !(RESERVED_FIELD_IDENTIFIERS as readonly string[]).includes(identifier),
      { message: SUITE_FIELD_IDENTIFIER_RESERVED_MESSAGE },
    )
    .describe(
      "The field name, as scenarios and evaluator mappings address it. Lowercase letters, digits and underscores, starting with a letter.",
    ),
  type: z
    .enum(SUITE_FIELD_TYPES)
    .describe("The value type every scenario carries for this field."),
});
export type SuiteFieldDefinition = z.infer<typeof suiteFieldDefinitionSchema>;

/** The fields a suite declares, identifiers unique. */
export const suiteFieldDefinitionsSchema = z
  .array(suiteFieldDefinitionSchema)
  .max(MAX_SUITE_FIELDS)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.identifier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "identifier"],
          message: SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE,
        });
      }
      seen.add(field.identifier);
    });
  });

/** One scenario field value as stored. */
export const scenarioFieldValueSchema = z.union([
  z.string().max(MAX_SUITE_FIELD_TEXT_LENGTH),
  z.number(),
  z.boolean(),
]);
export type ScenarioFieldValue = z.infer<typeof scenarioFieldValueSchema>;

/** The values one scenario carries, keyed by field identifier. */
export const scenarioFieldValuesSchema = z.record(
  z.string().max(MAX_SUITE_FIELD_IDENTIFIER_LENGTH),
  scenarioFieldValueSchema,
);
export type ScenarioFieldValues = z.infer<typeof scenarioFieldValuesSchema>;

/** Reads a stored `fields` column. Null and a bad shape both read as none. */
export function parseSuiteFieldDefinitions(
  raw: unknown,
): SuiteFieldDefinition[] {
  if (raw === null || raw === undefined) return [];
  const parsed = suiteFieldDefinitionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Reads a stored scenario `fields` column. Null and a bad shape read as none. */
export function parseScenarioFieldValues(raw: unknown): ScenarioFieldValues {
  if (raw === null || raw === undefined) return {};
  const parsed = scenarioFieldValuesSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Whether a value counts as "no value" for the field that carries it. */
export function fieldValueIsBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

/**
 * Turns what a person or a caller typed into the field's own type.
 *
 * `undefined` means "no value": an empty string, a blank string, and a value
 * that cannot be read as the field's type all come back as that. A number
 * field accepts a number or a numeric string; a boolean field accepts a
 * boolean or the words true, false, yes and no; a text field accepts any
 * scalar and stores its text.
 */
export function coerceFieldValue({
  definition,
  raw,
}: {
  definition: Pick<SuiteFieldDefinition, "type">;
  raw: unknown;
}): string | number | boolean | undefined {
  if (fieldValueIsBlank(raw)) return undefined;
  switch (definition.type) {
    case "text": {
      if (typeof raw === "string") return raw;
      if (typeof raw === "number" || typeof raw === "boolean") {
        return String(raw);
      }
      return undefined;
    }
    case "number": {
      if (typeof raw === "number")
        return Number.isFinite(raw) ? raw : undefined;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
          return undefined;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") {
        const word = raw.trim().toLowerCase();
        if (word === "true" || word === "yes") return true;
        if (word === "false" || word === "no") return false;
      }
      return undefined;
    }
  }
}

/**
 * Whether a stored value already has the field's own type. Used where a value
 * is validated rather than coerced.
 */
export function fieldValueMatchesType({
  definition,
  value,
}: {
  definition: Pick<SuiteFieldDefinition, "type">;
  value: ScenarioFieldValue;
}): boolean {
  switch (definition.type) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
  }
}
