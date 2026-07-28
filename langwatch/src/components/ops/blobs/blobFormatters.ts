import { formatTimeAgo } from "~/components/ops/shared/formatters";

/** Verdict a sweep would reach, phrased for a reader rather than for the script. */
const OUTCOME_LABELS = {
  leased: { label: "In use", palette: "green" },
  repaired: { label: "Will shorten", palette: "orange" },
  reclaimed: { label: "Will delete", palette: "red" },
  bookkeeping: { label: "Leftover keys", palette: "gray" },
  pending: { label: "Expiring", palette: "yellow" },
} as const;

const UNKNOWN_OUTCOME = { label: "Unknown", palette: "gray" } as const;

/**
 * The sweeper's vocabulary grows server-side, so an outcome this build has
 * never heard of renders as Unknown rather than as a blank cell.
 */
export function sweepOutcomeLabel(outcome: string): {
  label: string;
  palette: string;
} {
  return (
    OUTCOME_LABELS[outcome as keyof typeof OUTCOME_LABELS] ?? UNKNOWN_OUTCOME
  );
}

/** Remaining lifetime. Null means the key carries no expiry at all. */
export function formatTtl(seconds: number | null): string {
  if (seconds === null) return "No expiry";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * How long ago the blob's oldest lease lapsed — i.e. how long since the holder
 * that should have released it stopped renewing.
 *
 * A deadline still in the future is not a lapse at all: something holds this
 * blob right now, so it reads as Live rather than as a countdown.
 */
export function formatLeaseLapse(deadlineMs: number | null): string {
  if (deadlineMs === null) return "None";
  if (deadlineMs >= Date.now()) return "Live";
  return formatTimeAgo(deadlineMs);
}
