/**
 * The expiration choice a virtual-key drawer offers, and the date it means.
 *
 * A period is easy to pick and impossible to check, so every surface that
 * offers one also states the date it resolves to. Both drawers share this
 * module so the create and edit paths cannot drift into meaning different
 * things by the same words.
 *
 * Everything here works in UTC. The stored value is an instant, and a
 * custom date is the end of the day the person picked: "the 20th" has to
 * keep working for the whole of the 20th, and resolving it in UTC is what
 * lets the preview echo back exactly the day that was chosen rather than
 * its neighbour.
 */

import { type Instant, Temporal, nowInstant, toDate, toEpochMs } from "@langwatch/time";
import { readHandledError } from "../../../model/handled-error.ts";
import { readableDate } from "../../../model/readable-date.ts";

/** The option a select is currently on. "" is Never, "custom" is a date. */
export type VirtualKeyExpirationPreset = "" | "1" | "7" | "30" | "180" | "365" | "custom";

export const VIRTUAL_KEY_EXPIRATION_OPTIONS: ReadonlyArray<{
  label: string;
  value: VirtualKeyExpirationPreset;
}> = [
  { label: "Never", value: "" },
  { label: "1 day", value: "1" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "6 months", value: "180" },
  { label: "1 year", value: "365" },
  { label: "Custom date", value: "custom" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant the chosen option means, or null for a key that never expires.
 *
 * Returns null for a custom option with no date yet, so a half-filled form
 * asks for nothing rather than sending a date nobody typed.
 */
export function resolveExpiresAt({
  preset,
  customDate,
  now = nowInstant(),
}: {
  preset: VirtualKeyExpirationPreset;
  /** A `yyyy-mm-dd` value straight off an `<input type="date">`. */
  customDate?: string;
  now?: Instant;
}): Instant | null {
  if (preset === "") return null;
  if (preset === "custom") return endOfDayUtc(customDate);
  const days = Number.parseInt(preset, 10);
  if (!Number.isFinite(days) || days <= 0) return null;
  return now.add({ milliseconds: days * MS_PER_DAY });
}

/**
 * The last millisecond of a `yyyy-mm-dd` day, UTC.
 *
 * Built from the split parts rather than parsing the string: a parse lands
 * on midnight, so a key set to expire "today" would be born expired, and
 * the whole day the person picked would be gone.
 *
 * A day that does not exist is refused rather than moved. A calendar that
 * rolls `2026-02-31` forward into March would save a key that expires three
 * days after the date on the form, which is worse than one that refuses.
 */
function endOfDayUtc(value: string | undefined): Instant | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  try {
    return Temporal.PlainDateTime.from(
      { year, month, day, hour: 23, minute: 59, second: 59, millisecond: 999 },
      { overflow: "reject" },
    )
      .toZonedDateTime("UTC")
      .toInstant();
  } catch {
    return null;
  }
}

/** The `yyyy-mm-dd` an `<input type="date">` shows for a stored instant. */
export function dateInputValue(at: Instant): string {
  return toDate(at).toISOString().slice(0, 10);
}

/**
 * The earliest day the date input accepts: tomorrow.
 *
 * Today is refused rather than accepted-and-then-rejected. A key that
 * expires at the end of today is legal by the server's rule, but a date
 * picker whose smallest useful answer is "in a few hours" reads as broken.
 */
export function earliestCustomDate(now: Instant = nowInstant()): string {
  return dateInputValue(now.add({ milliseconds: MS_PER_DAY }));
}

/**
 * The date in words, for the line under the select: "Thu, Aug 20, 2026".
 *
 * UTC, like everything else here, so the sentence names the day that was
 * picked rather than the one the reader's timezone rolls it into.
 */
export function formatExpiry(at: Instant): string {
  return readableDate(at).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The option that reproduces a stored date.
 *
 * Always "custom": a relative period cannot round-trip, because "7 days"
 * meant seven days from the moment it was saved and reopening the drawer
 * a week later would silently re-arm it.
 */
export function expirationStateFromStored(expiresAt: string | Instant | null): {
  preset: VirtualKeyExpirationPreset;
  customDate: string;
} {
  if (!expiresAt) return { preset: "", customDate: "" };
  const epochMs =
    typeof expiresAt === "string" ? toEpochMs(expiresAt) : expiresAt.epochMilliseconds;
  if (Number.isNaN(epochMs)) return { preset: "", customDate: "" };
  return {
    preset: "custom",
    customDate: dateInputValue(Temporal.Instant.fromEpochMilliseconds(epochMs)),
  };
}

/**
 * Why the expiration choice cannot be submitted yet, or null.
 *
 * The one incomplete state a date field has is "Custom date" with no day
 * typed. Every other option already carries its own answer.
 */
export function expiryIncompleteReason({
  preset,
  expiresAt,
}: {
  preset: VirtualKeyExpirationPreset;
  expiresAt: Instant | null;
}): string | null {
  if (preset === "custom" && !expiresAt) {
    return "Pick the date this key expires, or choose Never.";
  }
  return null;
}

/**
 * The complaint to paint under the expiration field, or null.
 *
 * A rejected date is the one failure a drawer can point at, so it goes on
 * the field rather than into a toast the reader has to map back to a form
 * they are still looking at. Anything else is somebody else's error.
 */
export function expiryFieldErrorFrom(error: unknown): string | null {
  const handled = readHandledError(error);
  if (handled?.code !== "virtual_key_expiry_in_past") return null;
  const fieldErrors = handled.meta.fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") {
    const messages = (fieldErrors as Record<string, unknown>).expiresAt;
    if (Array.isArray(messages) && typeof messages[0] === "string") {
      return messages[0];
    }
  }
  return "Pick a date in the future";
}

/**
 * Whether a key's date has passed, which is what every badge derives from.
 *
 * Status is not consulted: an expired key is still ACTIVE on the wire, and
 * a revoked or disabled one has a stop of its own to report first. Callers
 * decide the precedence; this answers the one question.
 */
export function isExpired(
  expiresAt: string | Instant | null | undefined,
  now: Instant = nowInstant(),
): boolean {
  if (!expiresAt) return false;
  const epochMs =
    typeof expiresAt === "string" ? toEpochMs(expiresAt) : expiresAt.epochMilliseconds;
  if (Number.isNaN(epochMs)) return false;
  return epochMs <= now.epochMilliseconds;
}
