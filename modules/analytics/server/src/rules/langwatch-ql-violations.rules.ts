/**
 * How much caller-written text a message may quote back. Echoing the identifier is what makes a
 * rejection actionable — "table not available" without a name is useless to an agent fixing a
 * five-table query.
 */
const MAX_ECHOED_IDENTIFIER = 80;

/**
 * Characters that survive `\s` flattening but have no business in an echoed
 * identifier: C0/C1 controls, zero-width characters, and the bidi override
 * range, which would otherwise ride back into terminals and agent logs.
 */
const UNPRINTABLE =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Quotes a caller-supplied identifier back at them, bounded and single-line. The bound counts
 * code points, not UTF-16 units.
 */
export function echoIdentifier(raw: string): string {
  const flattened = raw.replace(UNPRINTABLE, "").replace(/\s+/gu, " ").trim();
  const codePoints = Array.from(flattened);
  return codePoints.length > MAX_ECHOED_IDENTIFIER
    ? `${codePoints.slice(0, MAX_ECHOED_IDENTIFIER).join("")}…`
    : flattened;
}
