/**
 * The values a scenario carries for its test suite's fields, checked against
 * what the suite declares.
 *
 * @see specs/scenarios/scenario-fields.feature
 */

import {
  ScenarioFieldTypeInvalidError,
  ScenarioFieldUnknownError,
} from "./errors";
import {
  coerceFieldValue,
  fieldValueIsBlank,
  type ScenarioFieldValues,
  type SuiteFieldDefinition,
} from "./suite-fields";

/**
 * The values to store, in the field's own type, with blanks dropped.
 *
 * A key the suite does not declare is refused rather than stored: a value
 * nothing reads is a typo waiting to be found later. A value that cannot be
 * read as the field's type is refused too; a blank one is simply no value.
 */
export function readScenarioFieldValues({
  values,
  definitions,
}: {
  values: ScenarioFieldValues;
  definitions: SuiteFieldDefinition[];
}): ScenarioFieldValues {
  const byIdentifier = new Map(
    definitions.map((definition) => [definition.identifier, definition]),
  );
  const unknown = Object.keys(values).filter(
    (identifier) => !byIdentifier.has(identifier),
  );
  if (unknown.length > 0) {
    throw new ScenarioFieldUnknownError({
      identifiers: unknown,
      declared: definitions.map((definition) => definition.identifier),
    });
  }
  const stored: ScenarioFieldValues = {};
  for (const [identifier, raw] of Object.entries(values)) {
    if (fieldValueIsBlank(raw)) continue;
    const definition = byIdentifier.get(identifier)!;
    const value = coerceFieldValue({ definition, raw });
    if (value === undefined) {
      throw new ScenarioFieldTypeInvalidError({
        identifier,
        type: definition.type,
      });
    }
    stored[identifier] = value;
  }
  return stored;
}
