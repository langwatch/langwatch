export class ShorthandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShorthandParseError";
  }
}

export type ParsedPromptShorthand = {
  slug: string;
  tag: string | undefined;
  version: number | undefined;
  hadSuffix: boolean;
};

export function parsePromptShorthand(input: string): ParsedPromptShorthand {
  const colonIndex = input.lastIndexOf(":");
  if (colonIndex === -1) {
    return { slug: input, tag: undefined, version: undefined, hadSuffix: false };
  }
  const slug = input.substring(0, colonIndex);
  const suffix = input.substring(colonIndex + 1);
  if (slug.length === 0) {
    throw new ShorthandParseError(`Invalid format: slug must not be empty. Received "${input}"`);
  }
  if (suffix.length === 0) {
    throw new ShorthandParseError(
      `Invalid format: suffix after colon must not be empty. Received "${input}"`,
    );
  }
  if (suffix === "latest") return { slug, tag: undefined, version: undefined, hadSuffix: true };
  const parsed = Number(suffix);
  if (Number.isInteger(parsed) && parsed > 0)
    return { slug, tag: undefined, version: parsed, hadSuffix: true };
  return { slug, tag: suffix, version: undefined, hadSuffix: true };
}
