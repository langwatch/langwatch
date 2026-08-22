/**
 * Display rules for a derived `stats` item.
 *
 * The unit on a derived card is free text written by the model, so it arrives
 * as whatever word the model reached for. It reaches a card body that appends
 * it to the number, and "35" plus "percent" reads as "35percent". These rules
 * turn the word into the symbol a reader expects and decide whether the unit
 * hugs the number or stands off it.
 */

/** Unit words with a canonical symbol that joins the number tightly. */
const SYMBOL_FOR_UNIT: Record<string, string> = {
  percent: "%",
  percentage: "%",
  percents: "%",
  pct: "%",
  degrees: "°",
};

/** A unit is a symbol when it carries no letters, e.g. "%", "€", "°". */
const isSymbol = (unit: string): boolean => !/[a-z]/i.test(unit);

/**
 * The unit as it should be rendered, plus whether a space belongs before it.
 * A symbol hugs the number ("85%"); a word stands off it ("812 ms").
 */
export const resolveStatUnit = (
  unit: string | undefined,
): { display: string; spaced: boolean } | undefined => {
  const trimmed = unit?.trim();
  if (!trimmed) return undefined;

  const symbol = SYMBOL_FOR_UNIT[trimmed.toLowerCase()];
  if (symbol) return { display: symbol, spaced: false };

  return { display: trimmed, spaced: isSymbol(trimmed) ? false : true };
};

/** The full figure a reader sees, number and unit together. */
export const formatStatFigure = ({
  value,
  unit,
}: {
  value: string | number;
  unit?: string;
}): string => {
  const number = typeof value === "number" ? value.toLocaleString() : value;
  const resolved = resolveStatUnit(unit);
  if (!resolved) return number;
  return `${number}${resolved.spaced ? " " : ""}${resolved.display}`;
};

/**
 * Whether a set of items reads better as a bar comparison than as a row of
 * figures: two or more numeric readings on the same scale, which is the shape
 * an optimization report has (baseline against candidate). One reading has
 * nothing to compare against, and mixed units share no axis.
 */
export const isComparableSeries = (
  items: readonly { value: string | number; unit?: string }[],
): boolean => {
  if (items.length < 2) return false;
  if (!items.every((item) => typeof item.value === "number")) return false;
  const units = new Set(items.map((item) => item.unit?.trim().toLowerCase()));
  return units.size === 1;
};
