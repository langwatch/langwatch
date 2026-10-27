/**
 * The `--field` flag: `test-suite create|update` declares a field
 * (`identifier:type`); `scenario create|update` sets its value
 * (`identifier=value`) — both validated before sending, so a bad flag leaves nothing half-written.
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
 * `--field golden_sql=SELECT ...`, collected into a scenario's field values,
 * coerced by the suite's declared type when known (an undeclared name is
 * refused); otherwise true/false/numbers read as they look; the platform settles the rest.
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
      return rejectFlag(`Invalid ${FIELD_FLAG} value: ${pair} (expected identifier=value)`);
    }
    const identifier = pair.slice(0, separator).trim();
    const raw = pair.slice(separator + 1);
    if (definitions === undefined) {
      values.set(identifier, coerceParameterValue({ value: raw }));
      continue;
    }
    const definition = definitions.find((candidate) => candidate.identifier === identifier);
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
