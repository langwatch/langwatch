import Parse from "papaparse";

import { neutralizeFormula, neutralizeRows } from "./formula-guard.ts";

/** Excel reads a CSV as UTF-8 only when it opens with this; without it "é" turns to "Ã©". */
const BYTE_ORDER_MARK = "﻿";

/**
 * Turns a header row plus its data rows into a CSV file and hands it to the browser as a
 * download. `byteOrderMark` is for a file a person opens in a spreadsheet; leave it out for a
 * file a program reads back, which would take the mark as part of the first header.
 */
export function downloadCsv({
  fields,
  rows,
  fileName,
  byteOrderMark = false,
}: {
  fields: string[];
  rows: (string | number)[][];
  fileName: string;
  byteOrderMark?: boolean;
}): void {
  const csv = Parse.unparse({
    fields: fields.map(neutralizeFormula),
    data: neutralizeRows(rows),
  });
  const parts = byteOrderMark ? [BYTE_ORDER_MARK, csv] : [csv];
  const url = window.URL.createObjectURL(new Blob(parts, { type: "text/csv" }));

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
