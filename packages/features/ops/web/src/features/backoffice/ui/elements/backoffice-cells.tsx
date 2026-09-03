import { Text } from "@chakra-ui/react";
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

/** Human-readable date (respects locale, uses the user's TZ). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

/**
 * Turn a `<input type="date">` value into an ISO instant without drifting the
 * selected local calendar day across time zones.
 */
export function dateInputToISO(value: string): string | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  const [year, month, day] = parts;
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  return date.toISOString();
}
