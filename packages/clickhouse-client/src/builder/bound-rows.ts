/**
 * Rows zipped from parallel bound arrays (ADR-202, "The typed builder"): one column per array,
 * typed by its element. The source names no table and holds no tenant rows, so it never stands
 * in for a tenant table: a read still names one (`no-tenant-table`).
 * @see specs/clickhouse/typed-query-builder.feature
 */
import {
  type ColumnType,
  columnRef,
  type Expression,
  type RenderContext,
  slotOf,
  type ValueNode,
} from "./expression.ts";
import { QueryBuilderError } from "./query-builder-error.ts";
import { type ClickHouseTable, type ClickHouseTableFacts, IDENTIFIER } from "./table.ts";

/** A bound array, such as `param.strings(…)`: it reads no table. */
type BoundArray = Expression<readonly unknown[], never>;
type ElementOf<A> = A extends Expression<readonly (infer Value)[], never> ? Value : never;

export type BoundRowColumns<Arrays extends Readonly<Record<string, BoundArray>>> = {
  readonly [Column in keyof Arrays & string]: ColumnType<ElementOf<Arrays[Column]>>;
};

type BoundColumn = { readonly name: string; readonly node: ValueNode };

/** Each bound-rows source's arrays in column order; only `boundRows` makes one. */
const BOUND_ROWS = new WeakMap<ClickHouseTableFacts, readonly BoundColumn[]>();

function boundColumnOf({ name, array }: { name: string; array: BoundArray }) {
  const { node } = array;
  const element =
    node.kind === "value" && node.binding.conversion === undefined && Array.isArray(node.value)
      ? /^Array\((.+)\)$/.exec(node.binding.paramType)?.[1]
      : undefined;
  if (!IDENTIFIER.test(name) || node.kind !== "value" || element === undefined) {
    throw new QueryBuilderError({ kind: "bound-rows-not-arrays", column: name });
  }
  const type: ColumnType<unknown> = { clickhouse: element, paramType: element };
  return { name, node, type, length: (node.value as readonly unknown[]).length };
}

/** `arrayJoin(arrayZip(…))` of `arrays`, read as a table named `name`. */
export function boundRows<
  const Name extends string,
  const Arrays extends Readonly<Record<string, BoundArray>>,
>({
  name,
  arrays,
}: {
  name: Name;
  arrays: Arrays;
}): ClickHouseTable<Name, BoundRowColumns<Arrays>, "rows"> {
  if (!IDENTIFIER.test(name)) throw new QueryBuilderError({ kind: "bad-alias", name });
  const columns = Object.entries(arrays).map(([each, array]) =>
    boundColumnOf({ name: each, array }),
  );
  if (columns.length === 0)
    throw new QueryBuilderError({ kind: "bound-rows-not-arrays", column: "" });
  const lengths = [...new Set(columns.map((each) => each.length))];
  if (lengths.length > 1) throw new QueryBuilderError({ kind: "bound-rows-uneven", lengths });
  const facts: ClickHouseTableFacts = {
    kind: "rows",
    name,
    stored: name,
    tenantColumn: "",
    timeColumn: undefined,
    versionColumn: undefined,
    sortKey: [],
    columns: columns.map((each) => each.name),
  };
  BOUND_ROWS.set(
    facts,
    columns.map(({ name: column, node }) => ({ name: column, node })),
  );
  const refs = Object.fromEntries(
    columns.map((each) => [
      each.name,
      columnRef({ table: name, name: each.name, type: each.type }),
    ]),
  );
  return { ...refs, $table: facts } as ClickHouseTable<Name, BoundRowColumns<Arrays>, "rows">;
}

export const isBoundRows = (table: ClickHouseTableFacts): boolean => BOUND_ROWS.has(table);

/** The rows as a FROM source; undefined for any other table. */
export function boundRowsSource({
  table,
  context,
}: {
  table: ClickHouseTableFacts;
  context: RenderContext;
}): string | undefined {
  if (table.kind !== "rows") return undefined;
  const columns = BOUND_ROWS.get(table);
  if (columns === undefined) {
    throw new QueryBuilderError({ kind: "table-outside-scope", table: table.name, scope: "rows" });
  }
  const elements = columns.map(
    ({ name }, index) => `tupleElement(bound_row, ${index + 1}) AS ${name}`,
  );
  const arrays = columns.map(({ node }) => slotOf({ node, context }));
  const zipped = `SELECT arrayJoin(arrayZip(${arrays.join(", ")})) AS bound_row`;
  return `(SELECT ${elements.join(", ")} FROM (${zipped})) AS ${table.name}`;
}
