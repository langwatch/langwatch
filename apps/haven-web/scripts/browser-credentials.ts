/** Keeps what a person typed into a credential field out of everything `haven browser` prints. */

/** The autocomplete tokens that mark a field as holding a credential (HTML autofill). */
export const CREDENTIAL_AUTOCOMPLETE = [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
];

export const CREDENTIAL_MASK = "***";

/** Shorter values are hidden only where a field shows them: anywhere else they match plain text. */
const SHORTEST_FREE_TEXT_VALUE = 6;

/** Runs in the page: the non-empty values of its password and credential fields. */
export function credentialValuesOnPage(tokens: string[]): string[] {
  const isCredential = (el: Element) => {
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "password") return true;
    const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
    return autocomplete.some((token) => tokens.includes(token));
  };
  return [...document.querySelectorAll("input, textarea")]
    .filter(isCredential)
    .map((el) => (el as HTMLInputElement).value)
    .filter((value) => value.length > 0);
}

/** An ai-mode textbox line: `- textbox "Name" [ref=e5]: value`, the value a YAML scalar. */
const TEXTBOX_LINE = /^(\s*- textbox(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*: )(.+)$/;

function scalarValue(raw: string): string {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw;
}

/**
 * Hides credential values in a snapshot, a diff or any other text: a textbox showing one reads
 * `***` whatever its length, and a value long enough to be unambiguous is hidden wherever it is.
 */
export function redactCredentials({ text, values }: { text: string; values: string[] }): string {
  const hidden = new Set(values.filter((value) => value.length > 0));
  if (hidden.size === 0) return text;
  let out = text
    .split("\n")
    .map((line) => {
      const match = TEXTBOX_LINE.exec(line);
      return match && hidden.has(scalarValue(match[2]!)) ? `${match[1]}${CREDENTIAL_MASK}` : line;
    })
    .join("\n");
  for (const value of hidden) {
    if (value.length < SHORTEST_FREE_TEXT_VALUE) continue;
    for (const form of new Set([value, JSON.stringify(value).slice(1, -1)]))
      out = out.replaceAll(form, CREDENTIAL_MASK);
  }
  return out;
}
