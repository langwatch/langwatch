/**
 * The one rule every CSV this product writes has to apply. A spreadsheet treats a cell opening
 * with one of {@link FORMULA_LEADERS} as a formula to run, not text to show.
 */

/**
 * `-` is here alongside `=` and `+` because `-1+1` is arithmetic to a spreadsheet, and `@`
 * because it opens a legacy Lotus function that Excel still honours. TAB and CR lead because a
 * leading control character is stripped before the parse and can expose whatever follows it.
 */
export const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises a cell a spreadsheet would otherwise run, and returns everything else untouched.
 */
export const neutralizeFormula = <T extends string | number>(cell: T): T | string => {
  if (typeof cell !== "string" || cell.length === 0) return cell;
  if (!FORMULA_LEADERS.includes(cell[0]!)) return cell;
  if (Number.isFinite(Number(cell))) return cell;
  return `'${cell}`;
};

/** Convenience for the common `{ fields, data }` shape papaparse takes. */
export const neutralizeRows = <T extends string | number>(rows: T[][]): (T | string)[][] =>
  rows.map((row) => row.map(neutralizeFormula));
