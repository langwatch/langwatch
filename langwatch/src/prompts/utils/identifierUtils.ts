/**
 * Generates a unique identifier by appending a numeric suffix if needed.
 *
 * Creates identifiers following the pattern:
 * - First available: baseName (e.g., "input")
 * - Subsequent: baseName_N (e.g., "input_1", "input_2")
 *
 * @param baseName - The base name for the identifier (e.g., "input" or "output")
 * @param existingIdentifiers - Array of identifiers already in use
 * @returns A unique identifier string
 */
export function generateUniqueIdentifier({
  baseName,
  existingIdentifiers,
}: {
  baseName: string;
  existingIdentifiers: string[];
}): string {
  let counter = 1;
  let identifier = baseName;

  while (existingIdentifiers.includes(identifier)) {
    identifier = `${baseName}_${counter}`;
    counter++;
  }

  return identifier;
}

