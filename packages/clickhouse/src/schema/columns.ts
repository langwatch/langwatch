import { z } from "zod";

/**
 * The `ch.*` column builders (ADR-099 "The codec is positional and compiled",
 * "Four time roles", "A structural column must be frozen *and*
 * platform-controlled").
 *
 * Each builder returns a `ColumnDef`: the ClickHouse type name a migration's
 * DDL can be cross-checked against, a zod schema whose parse *is* the decode
 * (so validation and transform live in one place instead of two that can
 * drift), and a matching encode for the write path. Without this, every
 * repository hand-writes its own `fromRecord` mapper and the row type, the
 * decode, and the column list are declared three times per table — which is
 * exactly the drift ADR-099 documents in `recordDecode.ts` and its copies.
 *
 * `decode` never coerces a value it cannot represent into a plausible wrong
 * one — it throws. A silent `Number(undefined) -> NaN` written back to a
 * column is worse than a loud failure at read time.
 */

/**
 * Which of the four roles ADR-099 defines a time column plays. Only
 * `acceptedAt` is both frozen and platform-controlled, which is why it is the
 * one role eligible to anchor a partition key, a TTL, or a dedup-subquery
 * bound — `occurredAt` is customer-supplied and must never carry structure.
 */
export type TimeRole =
  | "occurredAt"
  | "acceptedAt"
  | "lastAcceptedAt"
  | "writtenAt";

/**
 * What one column carries: its ClickHouse type name, its decode/encode pair,
 * and the flags `defineTable` (a sibling module) needs to enforce which roles
 * may anchor a partition, a TTL, or a dedup bound (ADR-099).
 *
 * `./defineTable.ts` imports this type directly. `../codec/rowCodec.ts` does
 * not: it declares the three fields it needs as its own `WireColumn`, which
 * every `ColumnDef` satisfies structurally, so the codec stays a pure array
 * transform with no dependency on how a column was declared.
 */
export interface ColumnDef<T> {
  readonly chType: string;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  readonly decode: (cell: unknown) => T;
  readonly encode: (value: T) => unknown;
  /** Present only on time columns. Governs where the column may be used. */
  readonly timeRole?: TimeRole;
  /** Whether the value is fixed for the row's life. */
  readonly frozen: boolean;
  /** Whether the platform sets it, as opposed to the customer's process. */
  readonly platformControlled: boolean;
  readonly nullable: boolean;
}

/**
 * "A column, whatever it decodes to" — the constraint every generic over a
 * table's columns is written against.
 *
 * It cannot be written as `ColumnDef<unknown>`. `ColumnDef<T>` is invariant in
 * `T`: `decode` returns a `T` (covariant) and `encode` takes one
 * (contravariant), so under `strictFunctionTypes` a `ColumnDef<string>` is
 * assignable to neither `ColumnDef<unknown>` nor `ColumnDef<never>`. A
 * constraint spelled `Record<string, ColumnDef<unknown>>` therefore admits no
 * column any `ch.*` builder can produce, and every `defineTable` call fails to
 * typecheck at its own call site.
 *
 * `any` is the one argument that satisfies the check in both directions, and it
 * is confined to this constraint: `TableRow` still recovers each column's exact
 * value type through `ColumnDef<infer T>`, so nothing downstream widens.
 */
// biome-ignore lint/suspicious/noExplicitAny: the variance escape is the point — see above.
export type AnyColumnDef = ColumnDef<any>;

/** A table's columns, keyed by column name in declaration order. */
export type ColumnMap = Record<string, AnyColumnDef>;

/**
 * Raised for a wire value a column builder cannot represent, outside the
 * paths zod already guards (a `Map`'s encoded key, for instance, is checked
 * by hand because encode has no schema to run through). Kept local to this
 * module rather than shared with `@langwatch/event-sourcing`'s error
 * taxonomy — that package must stay free of any ClickHouse-shaped concept,
 * per this package's reason for existing.
 */
export class ColumnDecodeError extends Error {
  readonly chType: string;
  readonly cell: unknown;

  constructor(chType: string, cell: unknown, reason: string) {
    super(`cannot represent value for ClickHouse type ${chType}: ${reason}`);
    this.name = "ColumnDecodeError";
    this.chType = chType;
    this.cell = cell;
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Assembles the full `ColumnDef` from one place, so every builder — including
 * the wrappers that rebuild one from another (`nullable`, `lowCardinality`, the
 * four time-role wrappers) — states the same set of fields and none can quietly
 * omit one and inherit a default.
 */
function finalize<T>(core: {
  chType: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  decode: (cell: unknown) => T;
  encode: (value: T) => unknown;
  timeRole?: TimeRole;
  frozen: boolean;
  platformControlled: boolean;
  nullable: boolean;
}): ColumnDef<T> {
  return {
    chType: core.chType,
    schema: core.schema,
    decode: core.decode,
    encode: core.encode,
    timeRole: core.timeRole,
    frozen: core.frozen,
    platformControlled: core.platformControlled,
    nullable: core.nullable,
  };
}

function string(): ColumnDef<string> {
  const schema = z.string();
  return finalize({
    chType: "String",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

const UINT64_PATTERN = /^\d+$/;

/**
 * Decodes to `bigint`, never `number` — the client sends 64-bit integers as
 * strings precisely because they do not fit a JS double, and rounding one to
 * a `number` loses precision silently past 2^53 (ADR-099).
 */
function uint64(): ColumnDef<bigint> {
  const schema = z.string().transform((raw, ctx) => {
    if (!UINT64_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is not a valid UInt64 wire value`,
      });
      return z.NEVER;
    }
    return BigInt(raw);
  });
  return finalize({
    chType: "UInt64",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value.toString(),
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

const INT64_PATTERN = /^-?\d+$/;

/** Same rationale as `uint64` — decodes to `bigint` to avoid precision loss. */
function int64(): ColumnDef<bigint> {
  const schema = z.string().transform((raw, ctx) => {
    if (!INT64_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is not a valid Int64 wire value`,
      });
      return z.NEVER;
    }
    return BigInt(raw);
  });
  return finalize({
    chType: "Int64",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value.toString(),
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * ClickHouse's JSON formats emit a Float64 as a JSON number, except NaN and
 * the two infinities, which are emitted as the bare strings `"nan"`,
 * `"inf"`, `"-inf"` (they are not valid JSON numbers). Anything else that
 * arrives as a string is rejected rather than coerced through `Number()`.
 */
function float64(): ColumnDef<number> {
  const schema = z
    .union([z.number(), z.literal("nan"), z.literal("inf"), z.literal("-inf")])
    .transform((raw) => {
      if (raw === "nan") return NaN;
      if (raw === "inf") return Infinity;
      if (raw === "-inf") return -Infinity;
      return raw;
    });
  return finalize({
    chType: "Float64",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * The widths ClickHouse emits as JSON numbers rather than strings. `uint64` is
 * not one of them — a 64-bit value exceeds `Number.MAX_SAFE_INTEGER`, so it
 * crosses the wire as a string and decodes to `bigint`.
 */
function smallUint(bits: 8 | 16 | 32): ColumnDef<number> {
  const chType = `UInt${bits}`;
  const max = 2 ** bits - 1;
  const schema = z
    .number()
    .int()
    .min(0)
    .max(max, { message: `value does not fit ${chType}` });
  return finalize({
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

function uint8(): ColumnDef<number> {
  return smallUint(8);
}

function uint16(): ColumnDef<number> {
  return smallUint(16);
}

function uint32(): ColumnDef<number> {
  return smallUint(32);
}

function boolean(): ColumnDef<boolean> {
  const schema = z.boolean();
  return finalize({
    chType: "Bool",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

const DATETIME64_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * Builds the decode/encode pair shared by `dateTime64` and the four time-role
 * builders below.
 *
 * ClickHouse's `DateTime64` wire form is space-separated
 * (`"2024-01-15 10:30:00.123"`), never `T`-separated, and carries no
 * timezone marker — the column's timezone is a server/session setting, not
 * part of the value. Every writer in this codebase pins UTC, so decode and
 * encode both treat the string as UTC; a column actually stored in another
 * timezone would decode wrongly, silently, and this builder has no way to
 * detect that from the wire value alone.
 *
 * `Date` only holds millisecond resolution, so a `precision` above 3 loses
 * the sub-millisecond digits on decode (truncated, not rounded) and encode
 * always re-pads with trailing zeros rather than inventing precision that
 * was never there.
 *
 * Calendar overflow (`"2024-02-30"`) is rejected rather than rolled forward
 * into March — `Date.UTC` normalises out-of-range fields silently, which is
 * exactly the "coerce to a plausible wrong value" this module exists to
 * avoid, so the reconstructed date's fields are checked against the parsed
 * ones before it is accepted.
 */
function dateTime64Codec(precision: number) {
  const schema = z.string().transform((raw, ctx) => {
    const match = DATETIME64_PATTERN.exec(raw);
    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" does not match the ClickHouse DateTime64 wire form`,
      });
      return z.NEVER;
    }
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, fraction] =
      match;
    if (
      yearStr === undefined ||
      monthStr === undefined ||
      dayStr === undefined ||
      hourStr === undefined ||
      minuteStr === undefined ||
      secondStr === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is missing a required DateTime64 component`,
      });
      return z.NEVER;
    }
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = Number(secondStr);
    const millis = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
    const time = Date.UTC(year, month - 1, day, hour, minute, second, millis);
    const date = new Date(time);
    const roundTrips =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      date.getUTCHours() === hour &&
      date.getUTCMinutes() === minute &&
      date.getUTCSeconds() === second;
    if (!roundTrips) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is not a valid calendar date/time`,
      });
      return z.NEVER;
    }
    return date;
  });

  const encode = (value: Date): unknown => {
    const datePart = `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;
    const timePart = `${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}`;
    if (precision <= 0) return `${datePart} ${timePart}`;
    const millisPart = pad(value.getUTCMilliseconds(), 3);
    const fractional = millisPart.padEnd(precision, "0").slice(0, precision);
    return `${datePart} ${timePart}.${fractional}`;
  };

  return { schema, encode };
}

function dateTime64(precision: number): ColumnDef<Date> {
  const codec = dateTime64Codec(precision);
  return finalize({
    chType: `DateTime64(${precision})`,
    schema: codec.schema,
    decode: (cell) => codec.schema.parse(cell),
    encode: codec.encode,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * A plain ClickHouse `DateTime` column — second precision, no time role.
 * Shares `dateTime64Codec(0)`'s decode/encode, so its wire bytes are
 * identical to `dateTime64(0)`; only `chType` differs, matching a migration
 * that declares the column as `DateTime` rather than `DateTime64(0)`.
 */
function dateTime(): ColumnDef<Date> {
  const codec = dateTime64Codec(0);
  return finalize({
    chType: "DateTime",
    schema: codec.schema,
    decode: (cell) => codec.schema.parse(cell),
    encode: codec.encode,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function date(): ColumnDef<Date> {
  const schema = z.string().transform((raw, ctx) => {
    const match = DATE_PATTERN.exec(raw);
    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" does not match the ClickHouse Date wire form`,
      });
      return z.NEVER;
    }
    const [, yearStr, monthStr, dayStr] = match;
    if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is missing a required Date component`,
      });
      return z.NEVER;
    }
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const time = Date.UTC(year, month - 1, day);
    const value = new Date(time);
    const roundTrips =
      value.getUTCFullYear() === year &&
      value.getUTCMonth() === month - 1 &&
      value.getUTCDate() === day;
    if (!roundTrips) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is not a valid calendar date`,
      });
      return z.NEVER;
    }
    return value;
  });
  return finalize({
    chType: "Date",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) =>
      `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * ClickHouse's JSON formats render a `Map` column as a JSON object whose
 * keys are the map key's string representation, regardless of the key
 * column's declared type. Decode therefore always reads object keys as
 * strings and hands them to `keyCol.decode`, which is why `uint64`/`int64`
 * keys work here even though a JS object key is never a `bigint`.
 */
function map<K, V>(
  keyCol: ColumnDef<K>,
  valueCol: ColumnDef<V>,
): ColumnDef<Map<K, V>> {
  const chType = `Map(${keyCol.chType}, ${valueCol.chType})`;
  const schema = z.record(z.string(), z.unknown()).transform((raw) => {
    const result = new Map<K, V>();
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      result.set(keyCol.decode(rawKey), valueCol.decode(rawValue));
    }
    return result;
  });
  return finalize({
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => {
      const result: Record<string, unknown> = {};
      for (const [key, val] of value) {
        const encodedKey = keyCol.encode(key);
        if (typeof encodedKey !== "string") {
          throw new ColumnDecodeError(
            chType,
            encodedKey,
            "a map key must encode to a string for the JSON wire form",
          );
        }
        result[encodedKey] = valueCol.encode(val);
      }
      return result;
    },
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

function array<T>(itemCol: ColumnDef<T>): ColumnDef<T[]> {
  const chType = `Array(${itemCol.chType})`;
  const schema = z
    .array(z.unknown())
    .transform((raw) => raw.map((item) => itemCol.decode(item)));
  return finalize({
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value.map((item) => itemCol.encode(item)),
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * Wraps a column as `Nullable(...)`. ClickHouse's JSON formats represent a
 * SQL `NULL` as JS `null`, so decode short-circuits on `null` before handing
 * anything to the inner column, and encode does the reverse. Everything else
 * about the inner column — including its time role, if it has one — carries
 * through unchanged; nullability does not change what the value means.
 */
function nullable<T>(inner: ColumnDef<T>): ColumnDef<T | null> {
  const chType = `Nullable(${inner.chType})`;
  const schema = inner.schema.nullable();
  return finalize({
    chType,
    schema,
    decode: (cell) => (cell === null ? null : inner.decode(cell)),
    encode: (value) => (value === null ? null : inner.encode(value)),
    timeRole: inner.timeRole,
    frozen: inner.frozen,
    platformControlled: inner.platformControlled,
    nullable: true,
  });
}

/**
 * Wraps a column as `LowCardinality(...)`. Purely a storage hint to
 * ClickHouse — the JSON wire representation of a `LowCardinality(String)` is
 * identical to a plain `String`, so decode and encode are untouched.
 */
function lowCardinality<T>(inner: ColumnDef<T>): ColumnDef<T> {
  return finalize({
    chType: `LowCardinality(${inner.chType})`,
    schema: inner.schema,
    decode: inner.decode,
    encode: inner.encode,
    timeRole: inner.timeRole,
    frozen: inner.frozen,
    platformControlled: inner.platformControlled,
    nullable: inner.nullable,
  });
}

/**
 * Declares a ClickHouse `Enum8`/`Enum16` from the same `{ label: ordinal }`
 * mapping the DDL uses, so the two cannot drift silently. The wire value is
 * always the string label, never the ordinal — ClickHouse's JSON formats
 * render an Enum by its label — so only the labels need validating.
 */
function enum_<const M extends Record<string, number>>(
  mapping: M,
): ColumnDef<keyof M & string> {
  const entries = Object.entries(mapping);
  const labels = entries.map(([label]) => label);
  const [first, ...rest] = labels;
  if (first === undefined) {
    throw new ColumnDecodeError("Enum", mapping, "an enum needs at least one member");
  }
  const width = entries.some(([, ordinal]) => ordinal > 127 || ordinal < -128)
    ? 16
    : 8;
  const chType = `Enum${width}(${entries.map(([label, ordinal]) => `'${label}' = ${ordinal}`).join(", ")})`;
  const schema = z.enum([first, ...rest]) as unknown as z.ZodType<
    keyof M & string,
    z.ZodTypeDef,
    unknown
  >;
  return finalize({
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * A JSON payload stored as a plain `String` column — this codebase never
 * declares ClickHouse's native `JSON` type (verified against the migrations
 * directory); every JSON-shaped column is `String` with the payload
 * serialised into it. `inner` validates the parsed shape, so a row written by
 * an older version of the schema fails loudly at read time rather than
 * decoding into a value the caller only half-trusts.
 */
function json<T>(inner: z.ZodType<T>): ColumnDef<T> {
  const schema = z.string().transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `not valid JSON: ${(error as Error).message}`,
      });
      return z.NEVER;
    }
    const result = inner.safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `does not match the declared JSON schema: ${result.error.message}`,
      });
      return z.NEVER;
    }
    return result.data;
  });
  return finalize({
    chType: "String",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => JSON.stringify(inner.parse(value)),
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

const TIME_ROLE_PRECISION = 3;

/**
 * Wraps a base `Date` codec with one of the 4 ADR-099 roles: stamps
 * `timeRole` and looks up the role's fixed `frozen`/`platformControlled`
 * pair, so every representation of a role (`dateTime64` today, `epochMillis`
 * below) states the flags once instead of at each wire form.
 */
const TIME_ROLE_FLAGS: Record<
  TimeRole,
  { readonly frozen: boolean; readonly platformControlled: boolean }
> = {
  occurredAt: { frozen: false, platformControlled: false },
  acceptedAt: { frozen: true, platformControlled: true },
  lastAcceptedAt: { frozen: false, platformControlled: true },
  writtenAt: { frozen: false, platformControlled: true },
};

function withTimeRole(base: ColumnDef<Date>, role: TimeRole): ColumnDef<Date> {
  const flags = TIME_ROLE_FLAGS[role];
  return finalize({
    chType: base.chType,
    schema: base.schema,
    decode: base.decode,
    encode: base.encode,
    timeRole: role,
    frozen: flags.frozen,
    platformControlled: flags.platformControlled,
    nullable: false,
  });
}

/**
 * The customer's process sets this and it moves — never frozen, never
 * platform-controlled. Structurally ineligible for a partition key, a TTL
 * anchor, or a dedup-subquery bound (ADR-099); `defineTable` reads
 * `timeRole`/`frozen`/`platformControlled` to enforce that.
 */
function occurredAt(precision: number = TIME_ROLE_PRECISION): ColumnDef<Date> {
  return withTimeRole(dateTime64(precision), "occurredAt");
}

/**
 * Our ingest boundary stamps this on the *anchoring* event and it never
 * moves again — the one role that is both frozen and platform-controlled, so
 * it is the only role eligible to anchor a partition key, a TTL, or a
 * dedup-subquery bound (ADR-099).
 */
function acceptedAt(precision: number = TIME_ROLE_PRECISION): ColumnDef<Date> {
  return withTimeRole(dateTime64(precision), "acceptedAt");
}

/**
 * Our boundary stamps this on the latest applied event, so — unlike
 * `acceptedAt` — it moves. Platform-controlled, and the correct column for
 * row-level last-write-wins ordering (ADR-099); `acceptedAt` is frozen and
 * cannot order anything.
 */
function lastAcceptedAt(
  precision: number = TIME_ROLE_PRECISION,
): ColumnDef<Date> {
  return withTimeRole(dateTime64(precision), "lastAcceptedAt");
}

/**
 * Stamped by the projection on every write. Platform-controlled and moving —
 * this is the `ReplacingMergeTree` version column (ADR-099).
 */
function writtenAt(precision: number = TIME_ROLE_PRECISION): ColumnDef<Date> {
  return withTimeRole(dateTime64(precision), "writtenAt");
}

/**
 * A UInt64 wire value carrying epoch milliseconds, decoded to `Date` — the
 * representation `event_log`'s deployed DDL uses (migration
 * `00002_create_schema.sql:24,28,35`): `EventTimestamp` and `EventOccurredAt`
 * are both `UInt64`, and the partition expression
 * `toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))` feeds `EventOccurredAt
 * / 1000` to `toDateTime64`, which takes seconds — so the stored integer is
 * milliseconds, confirmed independently by the write path
 * (`eventStoreUtils.ts`'s `eventToRecord`/`recordToEvent`, which round-trip
 * both columns through `Date.now()`-scale `timestampMs` values, never
 * `Date.now() / 1000`).
 *
 * ClickHouse's JSON formats send every UInt64 as a wire string regardless of
 * its magnitude — same reason as `uint64()` — so decode starts from a string
 * and rejects anything that is not one. A `Date`'s internal time value tops
 * out at 8.64e15ms (ECMA-262), inside `Number.MAX_SAFE_INTEGER` but not the
 * same bound, so a wire value is checked against both: one that cannot be
 * represented as a safe JS integer, or one that is safe but still outside
 * the range `Date` can hold, throws rather than silently truncating or
 * producing an `Invalid Date`.
 */
function epochMillis(): ColumnDef<Date> {
  const schema = z.string().transform((raw, ctx) => {
    if (!UINT64_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is not a valid UInt64 wire value`,
      });
      return z.NEVER;
    }
    const asBigInt = BigInt(raw);
    if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" exceeds Number.MAX_SAFE_INTEGER and cannot decode to a Date without precision loss`,
      });
      return z.NEVER;
    }
    const date = new Date(Number(asBigInt));
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${raw}" is outside the range a Date can represent`,
      });
      return z.NEVER;
    }
    return date;
  });
  return finalize({
    chType: "UInt64",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value.getTime().toString(),
    frozen: false,
    platformControlled: false,
    nullable: false,
  });
}

/**
 * The 4 role builders above, built on `epochMillis()` instead of
 * `dateTime64()` — identical role, identical `frozen`/`platformControlled`
 * flags, identical eligibility to anchor a partition, a TTL or a version;
 * only the wire form differs. Exists because a deployed migration is
 * immutable and `event_log` already shipped its time roles as `UInt64`
 * (ADR-099).
 */
function occurredAtEpochMillis(): ColumnDef<Date> {
  return withTimeRole(epochMillis(), "occurredAt");
}

function acceptedAtEpochMillis(): ColumnDef<Date> {
  return withTimeRole(epochMillis(), "acceptedAt");
}

function lastAcceptedAtEpochMillis(): ColumnDef<Date> {
  return withTimeRole(epochMillis(), "lastAcceptedAt");
}

function writtenAtEpochMillis(): ColumnDef<Date> {
  return withTimeRole(epochMillis(), "writtenAt");
}

/** The full set of `ch.*` column builders. See the module docblock. */
export const ch = {
  string,
  uint8,
  uint16,
  uint32,
  uint64,
  int64,
  float64,
  boolean,
  dateTime64,
  dateTime,
  date,
  map,
  array,
  nullable,
  lowCardinality,
  enum_,
  json,
  occurredAt,
  acceptedAt,
  lastAcceptedAt,
  writtenAt,
  epochMillis,
  occurredAtEpochMillis,
  acceptedAtEpochMillis,
  lastAcceptedAtEpochMillis,
  writtenAtEpochMillis,
};
