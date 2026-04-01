/**
 * Result of parsing a prompt shorthand string like "slug:tag" or "slug:version".
 */
export interface PromptShorthand {
  slug: string;
  tag: string | undefined;
  version: number | undefined;
  /** Whether the input contained a colon suffix (true even for "latest" which normalizes away). */
  hadSuffix: boolean;
}

/**
 * Parses a shorthand prompt reference string.
 *
 * Supported formats:
 * - `"pizza-prompt:production"` -> slug with tag
 * - `"pizza-prompt:2"` -> slug with version (positive integer)
 * - `"pizza-prompt"` -> bare slug
 * - `"pizza-prompt:latest"` -> treated as bare slug (no-op)
 * - `"my-org/prompt:staging"` -> slug with slash preserved
 *
 * Uses `lastIndexOf(':')` to split because slugs may contain `/` but the
 * suffix after the last `:` is always the tag or version.
 *
 * Disambiguation: if the suffix parses as a positive integer, it is a version;
 * otherwise it is a tag. "latest" is treated as a no-op (no tag, no version).
 *
 * @param input - The shorthand string to parse
 * @returns Parsed shorthand with slug, optional tag, and optional version
 * @throws Error if the slug portion is empty
 */
export function parsePromptShorthand(input: string): PromptShorthand {
  const colonIndex = input.lastIndexOf(":");

  if (colonIndex === -1) {
    return { slug: input, tag: undefined, version: undefined, hadSuffix: false };
  }

  const slug = input.substring(0, colonIndex);
  const suffix = input.substring(colonIndex + 1);

  if (slug.length === 0) {
    throw new Error(
      `Invalid format: slug must not be empty. Received "${input}"`,
    );
  }

  if (suffix.length === 0) {
    throw new Error(
      `Invalid format: suffix after colon must not be empty. Received "${input}"`,
    );
  }

  if (suffix === "latest") {
    return { slug, tag: undefined, version: undefined, hadSuffix: true };
  }

  const parsed = Number(suffix);
  if (Number.isInteger(parsed) && parsed > 0) {
    return { slug, tag: undefined, version: parsed, hadSuffix: true };
  }

  return { slug, tag: suffix, version: undefined, hadSuffix: true };
}
