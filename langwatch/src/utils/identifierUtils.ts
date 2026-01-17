/**
 * Utility functions for identifier normalization and generation.
 * These must match the backend's normalize_to_variable_name in langwatch_nlp/studio/utils.py
 */

/**
 * Normalizes an identifier to be a valid Python variable name.
 * - Replaces spaces with underscores
 * - Removes all non-alphanumeric characters except underscores
 * - Lowercases the result
 */
export const normalizeIdentifier = (value: string): string => {
  return value
    .replace(/ /g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
};

/**
 * Generates a unique identifier by appending a numeric suffix if the base name already exists.
 * @param baseName - The desired identifier name
 * @param existingIdentifiers - List of identifiers that are already in use
 * @returns A unique identifier (either baseName or baseName_N where N is a number)
 */
export const generateUniqueIdentifier = (
  baseName: string,
  existingIdentifiers: string[]
): string => {
  if (!existingIdentifiers.includes(baseName)) {
    return baseName;
  }

  let counter = 1;
  while (existingIdentifiers.includes(`${baseName}_${counter}`)) {
    counter++;
  }
  return `${baseName}_${counter}`;
};
