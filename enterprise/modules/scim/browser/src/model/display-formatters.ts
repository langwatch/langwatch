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
