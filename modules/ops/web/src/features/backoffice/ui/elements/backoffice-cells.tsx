import { Text } from "@chakra-ui/react";
import {
  currentTimeZone,
  Temporal,
  toDate,
  toEpochMs,
  type Instant,
  type TimeInput,
} from "@langwatch/time";
import type { PropsWithChildren } from "react";

export interface PaginationState {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Dash placeholder for empty cell values in Ops backoffice tables. */
export function EmptyCell({ children }: PropsWithChildren) {
  return (
    <Text color="fg.muted" fontSize="sm">
      {children ?? "—"}
    </Text>
  );
}

/** The moment a cell prints, or null when the value is not a moment at all. */
function readableMoment(value: TimeInput): Instant | null {
  const epochMs = toEpochMs(value);
  if (Number.isNaN(epochMs)) return null;
  return Temporal.Instant.fromEpochMilliseconds(epochMs);
}

/** Human-readable date (respects locale, uses the user's TZ). */
export function formatDate(value: TimeInput | null | undefined): string {
  if (!value) return "—";
  const moment = readableMoment(value);
  if (moment === null) return "—";
  return toDate(moment).toLocaleDateString();
}

export function formatDateTime(value: TimeInput | null | undefined): string {
  if (!value) return "—";
  const moment = readableMoment(value);
  if (moment === null) return "—";
  const date = toDate(moment);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

/**
 * Turn a `<input type="date">` value into an ISO instant without drifting the
 * selected local calendar day across time zones.
 */
export function dateInputToISO(value: string): string | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  const isCalendarDay = parts.length === 3 && parts.every((part) => !Number.isNaN(part));
  if (!isCalendarDay) return null;
  const [year, month, day] = parts;
  const noonLocally = Temporal.PlainDateTime.from({
    year: year!,
    month: month!,
    day: day!,
    hour: 12,
  }).toZonedDateTime(currentTimeZone());
  return toDate(noonLocally).toISOString();
}
