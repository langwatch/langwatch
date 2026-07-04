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
 * counts as present when an occurrence is LINE-ALIGNED — its line contains only
 * the prompt plus surrounding whitespace — which is how a prompt that genuinely
 * survived as its own message/part appears in flattened text.
 *
 * `needle` is trimmed but the surviving line may be indented or trailing-padded,
 * so alignment tolerates leading/trailing WHITESPACE on the match's own line
 * (not just a bare `\n` boundary) — otherwise a padded but genuinely-present
 * prompt reads as absent and gets appended twice, distorting classification.
 * Non-whitespace on either side of the match on the same line still means a
 * mid-line substring, which does NOT count (the original false-positive guard).
 */
export function textContainsPromptLineAligned(
  text: string,
  prompt: string,
): boolean {
  const needle = prompt.trim();
  if (needle.length === 0) return false;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    if (isLineStart(text, idx) && isLineEnd(text, idx + needle.length)) {
      return true;
    }
    idx = text.indexOf(needle, idx + 1);
  }
  return false;
}

/** True when only whitespace sits between `idx` and the preceding newline (or
 * the start of the text) — the match begins its own (possibly indented) line. */
function isLineStart(text: string, idx: number): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true;
}

/** True when only whitespace sits between `idx` and the next newline (or the end
 * of the text) — the match ends its own line (trailing padding / CRLF included). */
function isLineEnd(text: string, idx: number): boolean {
  for (let i = idx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true;
}
