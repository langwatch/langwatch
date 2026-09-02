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
 * `papaparse` did not travel with it. The platform helper uses
 * `Papa.unparse`, which for these two exports is quoting and joining; the
 * eleven lines below do the same job to the same RFC 4180 rules, and adding a
 * dependency to a package to reach one function of it is the trade the datasets
 * family already declined twice.
 */

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
  return [fields, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
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
