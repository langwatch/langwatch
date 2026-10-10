/** Per-token rates as plain decimal text: never exponent notation, in or out. */

/** `1.155e-7` becomes `0.0000001155`; the shortest digits that round-trip are kept. */
export function formatRate(rate: number | undefined | null): string {
  if (rate == null || !Number.isFinite(rate)) return "";
  const text = String(rate);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Typed text to a rate; blank or unparseable is `undefined`. A pasted `1.2e-7` still parses. */
export function parseRate(text: string | number | undefined | null): number | undefined {
  if (text == null) return undefined;
  const trimmed = String(text).trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
