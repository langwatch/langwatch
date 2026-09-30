/**
 * The `--field` flag, on two command families.
 *
 * On `test-suite create|update` a value declares a field: `identifier:type`,
 * where the type is text, number or boolean. On `scenario create|update` a
 * value gives the scenario's value for a field: `identifier=value`, coerced
 * by the type the suite declares when the suite is known.
 *
 * Both are read before anything is sent, so a malformed flag never leaves a
 * half-written suite or scenario behind.
 */

import {
  type ScenarioFieldValues,
  SUITE_FIELD_TYPES,
  type SuiteFieldDefinition,
  coerceFieldValue,
  fieldValueIsBlank,
  suiteFieldDefinitionsSchema,
} from "@/internal/generated/types/suite-fields";
import { commandValidationError, reportCommandError } from "./errorOutput";
import { coerceParameterValue } from "./keyValueFlags";

/** The flag both families read their fields from. */
export const FIELD_FLAG = "--field";

const rejectFlag = (message: string): never => {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
};

/**
 * `--field golden_sql:text`, repeated, collected into the field list a suite
 * declares. The list is validated as the platform validates it, so a bad
 * identifier, a duplicate or a reserved name is refused here with the reason.
 */
export const parseSuiteFieldDefinitionFlags = ({
  pairs,
}: {
  pairs: string[] | undefined;
}): SuiteFieldDefinition[] | undefined => {
  if (pairs === undefined) return undefined;
  const definitions = pairs.map((pair) => {
    const separator = pair.lastIndexOf(":");
    if (separator <= 0 || separator === pair.length - 1) {
      return rejectFlag(
        `Invalid ${FIELD_FLAG} value: ${pair} (expected identifier:type, where the type is ${SUITE_FIELD_TYPES.join(", ")})`,
      );
    }
    return {
      identifier: pair.slice(0, separator).trim(),
      type: pair.slice(separator + 1).trim(),
    };
  });
  const parsed = suiteFieldDefinitionsSchema.safeParse(definitions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[0] === "number" ? issue.path[0] : undefined;
    const culprit = index !== undefined ? pairs[index] : undefined;
    return rejectFlag(
      `Invalid ${FIELD_FLAG} value${culprit ? `: ${culprit}` : ""} (${issue?.message ?? "not a field definition"})`,
    );
  }
  return parsed.data;
};

/**
 * `--field golden_sql=SELECT ...`, repeated, collected into the values a
 * scenario carries for the fields its suite declares.
 *
 * With the suite's definitions at hand, a value is coerced by its declared
 * type and a name the suite does not declare is refused with the list it
 * does. Without them, `true`, `false` and a plain number are read as what
 * they look like, and the platform settles the rest by name.
 */
export const parseScenarioFieldFlags = ({
  pairs,
  definitions,
}: {
  pairs: string[] | undefined;
  definitions?: SuiteFieldDefinition[];
}): ScenarioFieldValues | undefined => {
  if (pairs === undefined) return undefined;
  const values = new Map<string, string | number | boolean>();
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      return rejectFlag(
        `Invalid ${FIELD_FLAG} value: ${pair} (expected identifier=value)`,
      );
    }
    const identifier = pair.slice(0, separator).trim();
    const raw = pair.slice(separator + 1);
    if (definitions === undefined) {
      values.set(identifier, coerceParameterValue({ value: raw }));
      continue;
    }
    const definition = definitions.find(
      (candidate) => candidate.identifier === identifier,
    );
    if (!definition) {
      const declared = definitions.map((field) => field.identifier);
      return rejectFlag(
        declared.length > 0
          ? `Unknown field: ${identifier} (the test suite declares ${declared.join(", ")})`
          : `Unknown field: ${identifier} (the test suite declares no fields; add them with langwatch test-suite update <suite> --field ${identifier}:text)`,
      );
    }
    // A blank value is "no value", so the evaluators that read the field are
    // skipped for this scenario. A value that is there but does not read as
    // the field's type is a mistake the caller can fix from the message.
    if (fieldValueIsBlank(raw)) continue;
    const coerced = coerceFieldValue({ definition, raw });
    if (coerced === undefined) {
      return rejectFlag(
        `Invalid ${FIELD_FLAG} value: ${pair} (${identifier} is a ${definition.type} field)`,
      );
    }
    values.set(identifier, coerced);
  }
  return Object.fromEntries(values);
};
