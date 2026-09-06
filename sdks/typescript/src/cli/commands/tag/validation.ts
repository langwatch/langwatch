const TAG_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

/**
 * Validates a tag name against the allowed format.
 * @param name The tag name to validate.
 * @returns An error message string if invalid, or null if valid.
 */
export function validateTagName(name: string): string | null {
  if (!TAG_NAME_REGEX.test(name)) {
    return `Invalid tag name "${name}". Tag names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores.`;
  }
  return null;
}
