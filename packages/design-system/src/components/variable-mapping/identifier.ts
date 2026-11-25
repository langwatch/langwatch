/** The first of `baseName`, `baseName_1`, `baseName_2`, ... that is not already taken. */
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

/** A variable name as the workflow engine normalises it: underscores, alphanumerics, lower case. */
export function normalizeIdentifier(value: string): string {
  return value
    .replace(/ /g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
}
