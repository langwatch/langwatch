/**
 * Identifies non-empty assistant reply text in a provider content part.
 * Reasoning parts are excluded even when they also carry text.
 */
export function isReplyTextPart(part: {
  text?: unknown;
  thought?: unknown;
}): part is { text: string } {
  return typeof part.text === "string" && part.text.length > 0 && part.thought !== true;
}
