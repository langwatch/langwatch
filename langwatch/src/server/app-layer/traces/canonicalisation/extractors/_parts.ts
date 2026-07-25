/**
 * True when a message part carries ANSWER text: a non-empty `text` not tagged
 * as thinking. Gemini marks its reasoning with `thought: true` and pads the
 * final message with empty thoughtSignature parts; folding either in puts the
 * model's monologue ahead of its actual reply. One predicate, shared by every
 * walker that extracts reply text, so the rule cannot drift per shape.
 */
export function isReplyTextPart(part: {
  text?: unknown;
  thought?: unknown;
}): part is { text: string } {
  return (
    typeof part.text === "string" &&
    part.text.length > 0 &&
    part.thought !== true
  );
}
