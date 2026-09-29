import { Temporal, format, nowInstant } from "@langwatch/time";

/** The console's one clock, on @langwatch/time; a moment travels as epoch milliseconds. */
export const nowMs = () => nowInstant().epochMilliseconds;

export const msOf = ({ iso }: { iso: string }) => Temporal.Instant.from(iso).epochMilliseconds;

export const isoOf = ({ ms }: { ms: number }) =>
  Temporal.Instant.fromEpochMilliseconds(ms).toString();

/** The wall-clock time in the reader's zone: "14:02:09". */
export const clockOf = ({ ms }: { ms: number }) => format(ms, "HH:mm:ss");

export const dateTimeOf = ({ ms }: { ms: number }) => format(ms, "d MMM yyyy, HH:mm:ss");
