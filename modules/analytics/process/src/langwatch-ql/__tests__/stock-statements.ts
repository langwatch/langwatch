/**
 * The stock widget statements as saved widgets send them, read from the committed fixture so
 * every suite sees the same text.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface StockStatement {
  readonly label: string;
  readonly sql: string;
}

export function loadStockStatements(): StockStatement[] {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
      "utf8",
    ),
  );
}
