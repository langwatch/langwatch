import { customAlphabet } from "nanoid";

/**
 * Generates a new API key for LangWatch projects.
 * Format: sk-lw-{48 character alphanumeric string}
 *
 * @returns A new API key string
 */
export const generateApiKey = (): string => {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const randomPart = customAlphabet(alphabet, 48)();
  return `sk-lw-${randomPart}`;
};
