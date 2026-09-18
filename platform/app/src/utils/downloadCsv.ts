import Parse from "papaparse";

/**
 * Turns a header row plus its data rows into a CSV file and hands it to the
 * browser as a download. One place for the blob/anchor dance so every surface
 * that exports a table produces the same file and the same failure surface.
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
  const csv = Parse.unparse({ fields, data: rows });
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
