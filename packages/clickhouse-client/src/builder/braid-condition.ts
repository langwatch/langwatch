import { braidConditionTermsOf, type CompiledWhere } from "@langwatch/authorization";

import { braidConditionExpression } from "../authorized-reads.ts";
import { type Condition, expression } from "./expression.ts";
import { QueryBuilderError } from "./query-builder-error.ts";
import { type ClickHouseTable, type ColumnsSpec } from "./table.ts";

/** The span columns a braid condition's terms read (authorized-reads.ts predicateOf). */
function columnsReadBy(compiledWhere: CompiledWhere): string[] {
  const read = braidConditionTermsOf(compiledWhere.tree).map((term) => {
    if (term.kind === "nameEquals") return "SpanName";
    if (term.kind === "attributeEquals" && term.on !== "span") return "ResourceAttributes";
    return "SpanAttributes";
  });
  return [...new Set(read)];
}

/**
 * A braid's compiled condition as a plain condition over `table` (ADR-201 §7), for argMax,
 * countIf and AND/OR/NOT as well as `where`: every key and literal is a bound parameter, and
 * `Verified()` reads against `reader`. The table must declare every column the terms read.
 */
export function braidCondition<Name extends string, Columns extends ColumnsSpec>(
  table: ClickHouseTable<Name, Columns, "tenant" | "derived">,
  { compiledWhere, reader }: { compiledWhere: CompiledWhere; reader: string },
): Condition<Name> {
  const facts = table.$table;
  const columns = columnsReadBy(compiledWhere);
  const missing = columns.find((name) => !facts.columns.includes(name));
  if (missing !== undefined) {
    throw new QueryBuilderError({ kind: "foreign-column", table: facts.stored, column: missing });
  }
  return expression<boolean, Name>({
    kind: "braid",
    table: facts.name,
    columns,
    render: (prefix) => braidConditionExpression({ compiledWhere, reader, prefix }),
  });
}
