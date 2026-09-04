import { neutralizeFormula } from "@langwatch/csv";

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
 * rather than every caller having to remember. The rule itself is
 * `@langwatch/csv`, shared with every other writer in the product.
 *
 * `papaparse` did not travel with it: for these two exports the serializer is
 * quoting and joining, and the few lines below do the same job to the same RFC
 * 4180 rules.
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
