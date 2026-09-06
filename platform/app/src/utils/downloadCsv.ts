import Parse from "papaparse";
import { neutralizeFormula, neutralizeRows } from "./csvFormulaGuard";

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
    data: neutralizeRows(rows),
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
