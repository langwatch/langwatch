import { Temporal, nowInstant } from "@langwatch/time";

/** The console's one clock, on @langwatch/time; a moment travels as epoch milliseconds. */
export const nowMs = () => nowInstant().epochMilliseconds;

export const msOf = ({ iso }: { iso: string }) => Temporal.Instant.from(iso).epochMilliseconds;
