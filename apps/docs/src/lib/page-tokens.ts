/** The named approximation: about four characters per token for English prose and code. */
export const TOKENISER = "characters / 4";

export function approximateTokens({ text }: { text: string }) {
  return Math.ceil(text.length / 4);
}
