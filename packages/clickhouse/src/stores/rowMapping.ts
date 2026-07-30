import { z } from "zod";
import type { BatchContext } from "@langwatch/event-sourcing";
import type { AnyColumnDef, ColumnMap } from "../schema/columns";
import type { TableDefinition, TableRow } from "../schema/defineTable";

/**
 * The camelCase state field ↔ PascalCase column mapping, derived from the
 * fold's state schema and the table's own declaration rather than hand-written
 * per table. The name is mechanical; the value type is not, so the coercion is
 * decided by the schema's field type against the column's `chType`.
 */

/** The bookkeeping a store supplies for the columns no state field fills. */
export interface RowContext {
  readonly tenantId: string;
  readonly key: string;
  /** The state-shape version this build writes. */
  readonly version: string;
  readonly writtenAt: Date;
  readonly retentionDays: number;
}

/** How one fold's state becomes a row, and how a row becomes state again. */
export interface RowMapping<State, Columns extends ColumnMap> {
  toRow(state: State, context: RowContext): TableRow<Columns>;
  fromRow(row: TableRow<Columns>): State;
}

/** Thrown when a table's columns and a fold's state cannot be matched up. */
export class RowMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowMappingError";
  }
}

const RETENTION_COLUMN = "_retention_days";

export function toFieldName(column: string): string {
  return column.charAt(0).toLowerCase() + column.slice(1);
}

export function toColumnName(field: string): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

/**
 * Builds the derived mapping for one table.
 *
 * Both directions are checked at construction: every state field must have a
 * column, and every column must have a source — a state field, an explicit
 * `fill`, or one of the roles the store owns. A gap either way is refused here
 * rather than discovered as an encode failure on whichever tenant is busiest.
 */
export function deriveRowMapping<State, Columns extends ColumnMap>(args: {
  readonly table: TableDefinition<Columns>;
  /** The fold's state schema — the authority on which fields exist. */
  readonly state: z.ZodType<State>;
  /** The column(s) the fold key locates a row by; they are the store's to fill. */
  readonly key: (keyof Columns & string) | readonly (keyof Columns & string)[];
  readonly tenant: keyof Columns & string;
  readonly stateVersionColumn: keyof Columns & string;
  /** Columns no state field supplies, and how to produce them. */
  readonly fill?: Readonly<
    Partial<Record<keyof Columns & string, (state: State) => unknown>>
  >;
}): RowMapping<State, Columns> {
  const { table, tenant, stateVersionColumn } = args;
  const keyColumns = new Set<string>(
    typeof args.key === "string" ? [args.key] : args.key,
  );
  const fill = (args.fill ?? {}) as Record<
    string,
    ((state: State) => unknown) | undefined
  >;
  const columns = table.columns as ColumnMap;
  const shape = objectShape(args.state, table.name);

  const mergeVersionColumn =
    table.merge.kind === "replacing" ? table.merge.version : undefined;

  // A field fills its own column; the store's roles fill only what no field
  // claimed, so a state that carries its own key or tenant keeps them.
  const fields = Object.keys(shape).map((field) => {
    const column = toColumnName(field);
    if (!table.columnNames.includes(column)) {
      throw new RowMappingError(
        `table "${table.name}": state field "${field}" has no column "${column}"`,
      );
    }
    return { field, column, schema: shape[field]! };
  });

  const fromFields = new Set(fields.map((entry) => entry.column));

  // A frozen, platform-controlled column anchors the partition and the TTL. A
  // `fill` runs on every write, so filling one moves the anchor — the row
  // migrates partitions and a ReplacingMergeTree never collapses two versions
  // that landed in different ones. Such a column must come from state, where
  // the fold can freeze it on first write.
  for (const name of Object.keys(fill)) {
    const column = columns[name];
    if (!column?.frozen || !column.platformControlled) continue;
    throw new RowMappingError(
      `table "${table.name}": column "${name}" is frozen and platform-controlled, ` +
        `so it anchors the partition and cannot be re-stamped by a fill on every ` +
        `write — carry it in state and freeze it on first write`,
    );
  }

  for (const name of table.columnNames) {
    if (fromFields.has(name)) continue;
    if (name === tenant || keyColumns.has(name)) continue;
    if (name === stateVersionColumn) continue;
    if (name === mergeVersionColumn || name === RETENTION_COLUMN) continue;
    if (fill[name]) continue;
    throw new RowMappingError(
      `table "${table.name}": column "${name}" has no source — no state field ` +
        `"${toFieldName(name)}", no fill, and not a role the store owns`,
    );
  }

  const hasRetention = table.columnNames.includes(RETENTION_COLUMN);

  return {
    toRow(state, context) {
      const row: Record<string, unknown> = {};
      if (!fromFields.has(tenant)) row[tenant] = context.tenantId;
      // A composite key is only fillable from state; a single-column key falls
      // back to the fold key itself.
      if (keyColumns.size === 1) {
        const [only] = keyColumns;
        if (only && !fromFields.has(only)) row[only] = context.key;
      }
      row[stateVersionColumn] = context.version;
      if (mergeVersionColumn) row[mergeVersionColumn] = context.writtenAt;
      if (hasRetention) row[RETENTION_COLUMN] = context.retentionDays;
      for (const [name, produce] of Object.entries(fill)) {
        if (produce) row[name] = produce(state);
      }
      for (const entry of fields) {
        row[entry.column] = encodeValue({
          value: (state as Record<string, unknown>)[entry.field],
          column: columns[entry.column]!,
          schema: entry.schema,
          tableName: table.name,
          field: entry.field,
        });
      }
      return row as TableRow<Columns>;
    },

    fromRow(row) {
      const source = row as Record<string, unknown>;
      const state: Record<string, unknown> = {};
      for (const entry of fields) {
        state[entry.field] = decodeValue({
          value: source[entry.column],
          column: columns[entry.column]!,
          schema: entry.schema,
        });
      }
      return state as State;
    },
  };
}

/**
 * The one-way mapping an append store needs: a record becomes a row, and
 * nothing reads it back. There is no key, no state version and no merge
 * version to own, so the only rule is that every column has a source.
 */
export function deriveAppendMapping<Rec, Columns extends ColumnMap>(args: {
  readonly table: TableDefinition<Columns>;
  /** The fields a record is known to carry, so a gap fails at module load. */
  readonly record: z.ZodType<Rec>;
  /** Columns no record field supplies, and how to produce them. */
  readonly fill?: Readonly<
    Partial<{
      [Name in keyof Columns & string]: (
        record: Rec,
        context: BatchContext,
      ) => TableRow<Columns>[Name];
    }>
  >;
}): (record: Rec, context: BatchContext) => TableRow<Columns> {
  const { table } = args;
  const fill = (args.fill ?? {}) as Record<
    string,
    ((record: Rec, context: BatchContext) => unknown) | undefined
  >;
  const columns = table.columns as ColumnMap;
  const shape = objectShape(args.record, table.name);

  const derived = table.columnNames
    .filter((name) => !fill[name])
    .map((name) => ({ column: name, field: toFieldName(name) }));

  for (const { column, field } of derived) {
    if (!(field in shape)) {
      throw new RowMappingError(
        `table "${table.name}": column "${column}" has no source — no record ` +
          `field "${field}" and no fill`,
      );
    }
  }

  return (record, context) => {
    const source = record as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const { column, field } of derived) {
      row[column] = encodeValue({
        value: source[field],
        column: columns[column]!,
        schema: shape[field]!,
        tableName: table.name,
        field,
      });
    }
    for (const [column, produce] of Object.entries(fill)) {
      if (produce) row[column] = produce(record, context);
    }
    return row as TableRow<Columns>;
  };
}

function objectShape(
  schema: z.ZodTypeAny,
  tableName: string,
): Record<string, z.ZodTypeAny> {
  const base = unwrap(schema);
  if (!(base instanceof z.ZodObject)) {
    throw new RowMappingError(
      `table "${tableName}": the derived mapping needs an object state schema so it ` +
        `knows which fields exist; pass an explicit row mapping instead`,
    );
  }
  return base.shape as Record<string, z.ZodTypeAny>;
}

/** Peels the wrappers that do not change which primitive a field holds. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodCatch ||
      current instanceof z.ZodReadonly
    ) {
      current = current._def.innerType as z.ZodTypeAny;
      continue;
    }
    return current;
  }
}

/**
 * The coercion is decided by the column's OUTERMOST type only. `UInt64` inside
 * `Map(String, UInt64)` is a map value the column's own codec handles, not a
 * scalar this mapper converts.
 */
function outerType(chType: string): string {
  let type = chType;
  for (;;) {
    const match = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(type);
    if (!match?.[1]) return type;
    type = match[1];
  }
}

function isBigIntColumn(chType: string): boolean {
  return /^U?Int(?:64|128|256)$/.test(outerType(chType));
}

function isDateColumn(chType: string): boolean {
  return /^(?:Date|Date32|DateTime|DateTime64)\b/.test(outerType(chType));
}

function isMapColumn(chType: string): boolean {
  return outerType(chType).startsWith("Map(");
}

function encodeValue(args: {
  value: unknown;
  column: AnyColumnDef;
  schema: z.ZodTypeAny;
  tableName: string;
  field: string;
}): unknown {
  const { value, column, tableName, field } = args;
  if (value === undefined) {
    if (column.nullable) return null;
    throw new RowMappingError(
      `table "${tableName}": state field "${field}" is undefined and column ` +
        `"${toColumnName(field)}" is not nullable`,
    );
  }
  if (value === null) return null;

  // Only a scalar the schema itself calls a number is converted, so a `bigint`
  // in state stays a `bigint` and a 64-bit id never loses precision.
  if (unwrap(args.schema) instanceof z.ZodNumber) {
    if (isDateColumn(column.chType)) return new Date(value as number);
    if (isBigIntColumn(column.chType)) return BigInt(Math.round(value as number));
  }
  if (
    isMapColumn(column.chType) &&
    !(value instanceof Map) &&
    isRecord(value)
  ) {
    return new Map(Object.entries(value));
  }
  return value;
}

function decodeValue(args: {
  value: unknown;
  column: AnyColumnDef;
  schema: z.ZodTypeAny;
}): unknown {
  const { value, column } = args;
  if (value === null || value === undefined) return null;

  const base = unwrap(args.schema);
  if (base instanceof z.ZodNumber) {
    if (isDateColumn(column.chType) && value instanceof Date) {
      return value.getTime();
    }
    if (isBigIntColumn(column.chType) && typeof value === "bigint") {
      return Number(value);
    }
  }
  if (
    isMapColumn(column.chType) &&
    value instanceof Map &&
    !(base instanceof z.ZodMap)
  ) {
    return Object.fromEntries(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
