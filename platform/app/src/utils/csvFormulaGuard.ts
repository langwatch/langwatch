/**
 * The one rule every CSV this product writes has to apply.
 *
 * A spreadsheet treats a cell opening with one of {@link FORMULA_LEADERS} as a
 * formula to run, not text to show. RFC 4180 quoting does not stop it —
 * quoting protects the CSV grammar, not the spreadsheet reading the file — so
 * the only defence is a leading apostrophe, which Excel and Sheets both read as
 * "this is text" and drop on display.
 *
 * It lives here, apart from any writer, because the rule had been written twice
 * independently and bypassed seven times. Server-side serializers import it as
 * readily as browser-side ones; nothing in this file touches the DOM.
 *
 * @see src/utils/downloadCsv.ts — the browser-side writer
 * @see src/utils/__tests__/csvWritersUseTheGuard.unit.test.ts — stops writers
 *      growing back outside it
 */

/**
 * `-` is here alongside `=` and `+` because `-1+1` is arithmetic to a
 * spreadsheet, and `@` because it opens a legacy Lotus function that Excel
 * still honours. TAB and CR lead because a leading control character is
 * stripped before the parse and can expose whatever follows it.
 */
export const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises a cell a spreadsheet would otherwise run, and returns everything
 * else untouched.
 *
 * A value that is simply a number is left alone: "-5" is not a formula, and
 * quoting it would turn a number column into a text one — which breaks sorting
 * and every SUM written against the file. Non-strings pass through, so a caller
 * holding `(string | number)[]` can map this over the row without narrowing.
 */
export const neutralizeFormula = <T extends string | number>(
  cell: T,
): T | string => {
  if (typeof cell !== "string" || cell.length === 0) return cell;
  if (!FORMULA_LEADERS.includes(cell[0]!)) return cell;
  if (Number.isFinite(Number(cell))) return cell;
  return `'${cell}`;
};

/** Convenience for the common `{ fields, data }` shape papaparse takes. */
export const neutralizeRows = <T extends string | number>(
  rows: T[][],
): (T | string)[][] => rows.map((row) => row.map(neutralizeFormula));
