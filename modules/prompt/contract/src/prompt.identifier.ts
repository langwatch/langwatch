export function generateUniqueIdentifier({
  baseName,
  existingIdentifiers,
}: {
  baseName: string;
  existingIdentifiers: string[];
}): string {
  let counter = 1;
  let identifier = baseName;
  while (existingIdentifiers.includes(identifier)) identifier = `${baseName}_${counter++}`;
  return identifier;
}

/**
 * A variable identifier as the runtime will see it.
 *
 * Must match the engine's `normalize_to_variable_name`
 * (langwatch_nlp/studio/utils.py): spaces become underscores, everything that
 * is not alphanumeric or an underscore is dropped, and the result is
 * lower-cased.
 */
export function normalizeIdentifier(value: string): string {
  return value
    .replace(/ /g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
}
