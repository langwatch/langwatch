/**
 * A single column's wire contract: the ClickHouse type name the schema declares
 * (used to cross-check the server's own `WithNamesAndTypes` header), a decode
 * from a raw wire cell to the JS value, and an encode back to a raw wire cell.
 * ADR-099 ("The codec is positional and compiled") ties the three together per
 * column so a migration that changes a type is caught at the codec rather than
 * trusted silently.
 *
 * These are the only three fields the codec needs, declared as their own narrow
 * view rather than by importing the full `ColumnDef`, so this module stays a
 * pure array transform with no dependency on how a column was declared — which
 * is what lets the wire format be swapped when the client gains `RowBinary`.
 * `ColumnDef` from `../schema/columns` satisfies it structurally.
 */
export interface WireColumn<T> {
  readonly chType: string;
  readonly decode: (raw: unknown) => T;
  readonly encode: (value: T) => unknown;
}

/**
 * "A wire column, whatever it carries" — the element type of every column list
 * this module accepts.
 *
 * Not `WireColumn<unknown>`, for the same reason `AnyColumnDef` is not
 * `ColumnDef<unknown>` (see `../schema/columns`): `decode` returns a `T` and
 * `encode` takes one, so the type is invariant in `T` and a
 * `WireColumn<string>` is assignable to `WireColumn<unknown>` in neither
 * direction under `strictFunctionTypes`. A parameter spelled
 * `readonly WireColumn<unknown>[]` therefore rejects every concretely-typed
 * column array a caller can build, and forces a cast at each call site — which
 * is a cast in exactly the code whose job is to be type-correct about the wire.
 */
// biome-ignore lint/suspicious/noExplicitAny: the variance escape is the point — see above.
export type AnyWireColumn = WireColumn<any>;

/**
 * Thrown when the wire does not match what the schema declared: a
 * `WithNamesAndTypes` header naming different columns, or in a different
 * order, or with a different type than declared; or a row whose length does
 * not match the declared column count. Exists so a migration that silently
 * changes a column's shape fails loudly at the first read instead of
 * coercing wrong (ADR-099, "the codec is positional and compiled").
 */
export class WireShapeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireShapeMismatchError";
  }
}

/**
 * The positional wire codec described in ADR-099 and ADR-104: reads use
 * `JSONCompactEachRowWithNamesAndTypes` (a names row, a types row, then one
 * array per row), writes use `JSONCompactEachRow` (one array per row). Column
 * names cross the wire once per result rather than once per row, so decoding
 * is index arithmetic rather than key lookup. Kept behind an interface,
 * rather than called directly, because `RowBinary` and `Native` are absent
 * from `@clickhouse/client`'s supported format lists today — swapping the
 * wire format later means one new implementation, not a rewrite of every
 * call site.
 */
export interface WireCodec {
  readonly readFormat: string;
  readonly writeFormat: string;
  decodeRows<T>(args: {
    columns: readonly AnyWireColumn[];
    columnNames: readonly string[];
    header: { names: readonly string[]; types: readonly string[] } | undefined;
    rows: readonly unknown[][];
  }): T[];
  encodeRows<T>(args: {
    columns: readonly AnyWireColumn[];
    columnNames: readonly string[];
    rows: readonly T[];
  }): unknown[][];
}

function validateHeader(args: {
  columnNames: readonly string[];
  columns: readonly AnyWireColumn[];
  header: { names: readonly string[]; types: readonly string[] };
}): void {
  const { columnNames, columns, header } = args;

  if (header.names.length !== columnNames.length) {
    throw new WireShapeMismatchError(
      `server returned ${header.names.length} columns ([${header.names.join(", ")}]) but ${columnNames.length} were declared ([${columnNames.join(", ")}])`
    );
  }

  for (let i = 0; i < columnNames.length; i++) {
    const declaredName = columnNames[i]!;
    const serverName = header.names[i]!;
    if (declaredName !== serverName) {
      throw new WireShapeMismatchError(
        `column ${i} is declared as "${declaredName}" but the server returned "${serverName}" in that position`
      );
    }

    const declaredType = columns[i]!.chType;
    const serverType = header.types[i]!;
    if (declaredType !== serverType) {
      throw new WireShapeMismatchError(
        `column "${declaredName}" is declared as "${declaredType}" but the server returned "${serverType}"`
      );
    }
  }
}

/**
 * Builds the {@link WireCodec}. A function rather than a bare object so the
 * one implementation can be swapped for a `RowBinary` codec later without
 * changing callers (ADR-099).
 */
export function createRowCodec(): WireCodec {
  return {
    readFormat: "JSONCompactEachRowWithNamesAndTypes",
    writeFormat: "JSONCompactEachRow",

    decodeRows<T>(args: {
      columns: readonly AnyWireColumn[];
      columnNames: readonly string[];
      header: { names: readonly string[]; types: readonly string[] } | undefined;
      rows: readonly unknown[][];
    }): T[] {
      const { columns, columnNames, header, rows } = args;

      if (header) {
        validateHeader({ columnNames, columns, header });
      }

      return rows.map((row, rowIndex) => {
        if (row.length !== columnNames.length) {
          throw new WireShapeMismatchError(
            `row ${rowIndex} has ${row.length} values but ${columnNames.length} columns were declared ([${columnNames.join(", ")}])`
          );
        }

        const decoded: Record<string, unknown> = {};
        for (let i = 0; i < columnNames.length; i++) {
          decoded[columnNames[i]!] = columns[i]!.decode(row[i]);
        }
        return decoded as T;
      });
    },

    encodeRows<T>(args: {
      columns: readonly AnyWireColumn[];
      columnNames: readonly string[];
      rows: readonly T[];
    }): unknown[][] {
      const { columns, columnNames, rows } = args;

      return rows.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return columnNames.map((name, i) => columns[i]!.encode(record[name]));
      });
    },
  };
}
