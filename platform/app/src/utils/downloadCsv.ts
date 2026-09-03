import Parse from "papaparse";

/**
 * A spreadsheet treats a cell opening with one of these as a formula to run,
 * not text to show. Every value in these files is typed by somebody — a
 * comment, a suggestion, the reason given for a score — so a cell opening with
 * `=` is a formula the reader's spreadsheet would execute on their machine.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises a cell a spreadsheet would otherwise run. The leading quote is
 * what Excel and Sheets both read as "this is text"; it is dropped again on
 * display, so the reader still sees what was written.
 *
 * A value that is simply a number is left alone: "-5" is not a formula, and
 * quoting it would turn a number column into a text one.
 */
const neutralizeFormula = <T extends string | number>(cell: T): T | string => {
  if (typeof cell !== "string" || cell.length === 0) return cell;
  if (!FORMULA_LEADERS.includes(cell[0]!)) return cell;
  if (Number.isFinite(Number(cell))) return cell;
  return `'${cell}`;
};

/**
 * Turns a header row plus its data rows into a CSV file and hands it to the
 * browser as a download. One place for the blob/anchor dance so every surface
 * that exports a table produces the same file and the same failure surface —
 * and one place where a cell that would run as a formula is defused, rather
 * than every caller having to remember.
 *
 * The header row is defused with the rest. A column heading is not always
 * fixed text: a score type carries the name its project gave it, so a heading
 * can be just as much somebody's typing as the cells beneath it.
 */
export function downloadCsv({
  fields,
  rows,
  fileName,
}: {
  fields: string[];
  rows: (string | number)[][];
  fileName: string;
}): void {
  const csv = Parse.unparse({
    fields: fields.map(neutralizeFormula),
    data: rows.map((row) => row.map(neutralizeFormula)),
  });
  const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** `<name> - YYYY-MM-DD.csv`, the file name every export here uses. */
export function csvFileName(name: string, today = new Date()): string {
  return `${name} - ${today.toISOString().split("T")[0]}.csv`;
}
