/**
 * Per-widget Monaco typings for what each query returns: its last run's columns become
 * `LwQueryRowMap[queryName]`, so `rows[0].<column>` completes and type-checks. No run
 * yet falls back to an unknown row; the index signature keeps stale columns from erroring.
 */

export interface LwQueryColumnShape {
  readonly name: string;
  readonly type: string;
}

export interface LwQueryColumnsByName {
  readonly name: string;
  readonly columns: readonly LwQueryColumnShape[];
}

const WIDE_NUMBER = "string | number";

const SCALAR_TS_TYPES: readonly (readonly [RegExp, string])[] = [
  [/^U?Int(8|16|32)$/, "number"],
  [/^Float(32|64)$/, "number"],
  [/^U?Int(64|128|256)$/, WIDE_NUMBER],
  [/^Decimal/, WIDE_NUMBER],
  [/^Bool(ean)?$/, "boolean"],
  [/^(String|UUID|IPv[46]|Date(32)?|DateTime(64)?|FixedString|Enum(8|16)?)\b/, "string"],
];

function splitTopLevel({ args }: { args: string }): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const char = args[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts;
}

/** The TypeScript type a ClickHouse column type arrives as in a result row. */
export function lwColumnTsType({ clickhouseType }: { clickhouseType: string }): string {
  const match = /^(\w+)\((.*)\)$/s.exec(clickhouseType.trim());
  const wrapper = match?.[1];
  const args = match?.[2] ?? "";
  if (wrapper === "Nullable") return `${lwColumnTsType({ clickhouseType: args })} | null`;
  if (wrapper === "LowCardinality") return lwColumnTsType({ clickhouseType: args });
  if (wrapper === "SimpleAggregateFunction") {
    return lwColumnTsType({ clickhouseType: splitTopLevel({ args }).at(-1) ?? "" });
  }
  if (wrapper === "Array") return `(${lwColumnTsType({ clickhouseType: args })})[]`;
  if (wrapper === "Map") {
    const valueType = splitTopLevel({ args })[1] ?? "";
    return `Record<string, ${lwColumnTsType({ clickhouseType: valueType })}>`;
  }
  const scalar = SCALAR_TS_TYPES.find(([pattern]) => pattern.test(clickhouseType.trim()));
  return scalar?.[1] ?? "unknown";
}

/** The declaration merging a query's columns into `LwQueryRowMap`; empty when none ran. */
export function lwQueryRowTypesDts({
  queries,
}: {
  queries: readonly LwQueryColumnsByName[];
}): string {
  const entries = queries
    .filter((query) => query.columns.length > 0)
    .map((query) => {
      const fields = query.columns.map(
        (column) =>
          `    ${JSON.stringify(column.name)}: ${lwColumnTsType({ clickhouseType: column.type })};`,
      );
      return `  ${JSON.stringify(query.name)}: {\n${fields.join("\n")}\n    [column: string]: unknown;\n  };`;
    });
  return `interface LwQueryRowMap {\n${entries.join("\n")}\n}\n`;
}
