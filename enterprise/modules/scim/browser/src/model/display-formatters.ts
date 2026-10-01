import { Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

/** The moment a screen prints, as the `Date` the Intl formatters take. */
export function readableDate(value: TimeInput) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value)));
}

/** The protocols identity records, in the words an administrator reads. */
const PROTOCOL_WORDS: Record<string, string> = { oidc: "OIDC", saml: "SAML" };

/**
 * What the chooser calls a connection. Two connections at the same provider
 * read as one row twice over, and which of them carries the directory is the
 * protocol — so the name carries it where identity recorded one.
 */
export function connectionLabel({
  displayName,
  connectionType,
}: {
  displayName: string;
  connectionType: string;
}): string {
  const protocol = PROTOCOL_WORDS[connectionType.toLowerCase()];

  return protocol ? `${displayName} (${protocol})` : displayName;
}

/**
 * How long ago something happened, coarser as the gap widens; past a month it
 * hands over to the date itself. Absence is an answer: "Never".
 */
export function relativeTime({ atMs, nowMs }: { atMs: number | null; nowMs: number }): string {
  if (!atMs) return "Never";

  const seconds = Math.floor((nowMs - atMs) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return readableDate(atMs).toLocaleDateString();
}

/** A moment as a date and a time, in the reader's locale. */
export function readableDateTime(atMs: number): string {
  const date = readableDate(atMs);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
