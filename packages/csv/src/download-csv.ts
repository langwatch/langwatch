import Parse from "papaparse";

import { neutralizeFormula, neutralizeRows } from "./formula-guard.ts";

/**
 * Turns a header row plus its data rows into a CSV file and hands it to the browser as a
 * download.
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
