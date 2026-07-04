/**
 * Shared "did the fresh user prompt already survive in the recovered prefix?"
 * predicate for truncated-body recovery. Both consumers (the log-to-span
 * converter's `gen_ai.input.messages` reinstatement and the classifier's
 * `appendFreshTurnIfTruncated`) must judge presence identically or the
 * display and the classification drift.
 *
 * A bare `includes` is not enough: short prompts ("ok", "continue") appear
 * as substrings inside file dumps and reminder prose all the time, which
 * suppressed reinstatement and made the newest turn vanish. The prompt only
 * counts as present when an occurrence is LINE-ALIGNED — it starts at the
 * beginning of a line and ends at the end of one — which is how a prompt
 * that genuinely survived as its own message/part appears in flattened text.
 */
export function textContainsPromptLineAligned(
  text: string,
  prompt: string,
): boolean {
  const needle = prompt.trim();
  if (needle.length === 0) return false;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const startAligned = idx === 0 || text[idx - 1] === "\n";
    const endIdx = idx + needle.length;
    const endAligned =
      endIdx === text.length ||
      text[endIdx] === "\n" ||
      // A trailing \r before the newline (CRLF content) still ends the line.
      (text[endIdx] === "\r" && text[endIdx + 1] === "\n");
    if (startAligned && endAligned) return true;
    idx = text.indexOf(needle, idx + 1);
  }
  return false;
}
