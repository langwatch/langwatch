import { isStorableSpanTimeMs } from "./storable-span-time.rules.ts";

/** Usable timing and storable time are one rule: `occurredAt` mints the summary's KSUID. */
export const isValidTimestamp = (value: number | null | undefined): value is number =>
  isStorableSpanTimeMs(value);
