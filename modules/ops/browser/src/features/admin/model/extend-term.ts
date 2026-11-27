/** The new end date an operator picks under Extend term, as the date input holds it. */
import { currentTimeZone, Temporal } from "@langwatch/time";

import { formatDay } from "./license-chain.ts";

export const EXTEND_PRESETS = [
  { label: "+2 weeks", add: { days: 14 } },
  { label: "+1 month", add: { months: 1 } },
  { label: "+3 months", add: { months: 3 } },
  { label: "+1 year", add: { years: 1 } },
] as const;

export type ExtendPreset = (typeof EXTEND_PRESETS)[number];

/** The local calendar day a term ends on, as `YYYY-MM-DD`. */
export function dayOf(iso: string): string {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(currentTimeZone()).toPlainDate().toString();
}

/** The end date a preset moves the term to, counted from where it ends now. */
export function presetEnd({ expiresAt, preset }: { expiresAt: string; preset: ExtendPreset }) {
  return Temporal.PlainDate.from(dayOf(expiresAt)).add(preset.add).toString();
}

function parseDay(value: string) {
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
}

/** Why the typed end date cannot be saved, or undefined when it can. */
export function extendProblem({
  expiresAt,
  newEnd,
}: {
  expiresAt: string;
  newEnd: string;
}): string | undefined {
  if (newEnd === "") return "Pick the new end date.";
  const typed = parseDay(newEnd);
  if (!typed) return "Pick a valid date.";
  const ends = Temporal.PlainDate.from(dayOf(expiresAt));
  if (Temporal.PlainDate.compare(typed, ends) <= 0) {
    return `The new end date must be after ${formatDay(expiresAt)}.`;
  }
  return undefined;
}
