/**
 * Turns a header row plus its data rows into a CSV file and hands it to the
 * browser as a download.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/utils/downloadCsv`, which keeps its
 * other callers. It lives in `behavior` rather than `model` for the reason the
 * split exists: it touches the document, so it is not a portable value — what
 * the file SAYS is `model/annotation-export.ts`, and a test asserts on that
 * rather than on a blob.
 *
 * It is also the one place a cell that would RUN as a formula is defused,
 * rather than every caller having to remember.
 *
 * `papaparse` did not travel with it. The platform helper uses
 * `Papa.unparse`, which for these two exports is quoting and joining; the
 * eleven lines below do the same job to the same RFC 4180 rules, and adding a
 * dependency to a package to reach one function of it is the trade the datasets
 * family already declined twice.
 */

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
function neutralizeFormula(cell: string | number): string | number {
  if (typeof cell !== "string" || cell.length === 0) return cell;
  if (!FORMULA_LEADERS.includes(cell[0]!)) return cell;
  if (Number.isFinite(Number(cell))) return cell;
  return `'${cell}`;
}

/** RFC 4180: quote when the value carries a comma, a quote or a newline. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv({
  fields,
  rows,
}: {
  fields: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
}): string {
  // The header row is defused with the rest. A column heading is not always
  // fixed text: a score type carries the name its project gave it, so a
  // heading can be just as much somebody's typing as the cells beneath it.
  return [fields, ...rows]
    .map((row) => row.map((cell) => csvCell(neutralizeFormula(cell))).join(","))
    .join("\r\n");
}

export function downloadCsv({
  fields,
  rows,
  fileName,
}: {
  fields: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
  fileName: string;
}): void {
  const url = URL.createObjectURL(new Blob([toCsv({ fields, rows })], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
