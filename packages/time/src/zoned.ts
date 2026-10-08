/**
 * The boundary: a `Date`, an epoch millisecond count or an ISO string becomes a
 * `Temporal.ZonedDateTime` in the reader's time zone exactly once, and every
 * calculation after that is Temporal.
 */

import { Temporal as PolyfilledTemporal } from "temporal-polyfill";

type TemporalNamespace = typeof PolyfilledTemporal;

const scope = globalThis as { Temporal?: TemporalNamespace };

/** The runtime's own Temporal when it has one, the polyfill otherwise. */
export const Temporal: TemporalNamespace = scope.Temporal ?? PolyfilledTemporal;

export type Instant = PolyfilledTemporal.Instant;
export type ZonedDateTime = PolyfilledTemporal.ZonedDateTime;
export type PlainDateTime = PolyfilledTemporal.PlainDateTime;

/** What every operation in this package accepts where a moment is wanted. */
export type TimeInput = Date | number | string | ZonedDateTime;

export interface ZoneOptions {
  /** The zone the answer is read in. The reader's own zone by default. */
  timeZone?: string;
}

/** The time zone the reader is in right now. */
export function currentTimeZone(): string {
  return Temporal.Now.timeZoneId();
}

/** Epoch milliseconds for any accepted input. */
export function toEpochMs(value: TimeInput): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  if (value instanceof Date) return value.getTime();
  return value.epochMilliseconds;
}

/** The same moment, read in a time zone. */
export function toZonedDateTime(value: TimeInput, options?: ZoneOptions): ZonedDateTime {
  const timeZone = options?.timeZone ?? currentTimeZone();
  if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date)) {
    return value.withTimeZone(timeZone);
  }
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs)) {
    throw new RangeError("Invalid time value");
  }
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone);
}

/** The moment right now, as an instant. */
export function nowInstant(): Instant {
  return Temporal.Now.instant();
}

/** A `Date` from a boundary that only speaks `Date`, as an instant. */
export function fromDate(value: Date): Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

/** Back to a `Date`, for the boundaries that only accept one. */
export function toDate(value: Instant | ZonedDateTime): Date {
  return new Date(value.epochMilliseconds);
}

/** The moment a screen prints, as the `Date` the Intl formatters take. */
export function readableDate(value: TimeInput): Date {
  return new Date(toEpochMs(value));
}
