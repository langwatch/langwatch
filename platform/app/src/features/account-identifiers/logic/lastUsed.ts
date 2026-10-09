/**
 * "Last used" in the words somebody deciding whether to delete something
 * actually needs.
 *
 * The question this answers is never "what is the timestamp" — it is "am I
 * still relying on this?". So the near past is relative, because "yesterday"
 * settles it instantly and a date makes you count; and the far past becomes a
 * date, because "417 days ago" is a number nobody can picture.
 *
 * A method with no answer returns null and the row says NOTHING, which is the
 * important case. Sessions expire and are deleted, so an absent answer means
 * "not in any session we still hold", not "never used" — and telling somebody
 * a passkey was never used, when the evidence merely aged out, is how you talk
 * them into deleting the credential they sign in with.
 */
export function lastUsedLabel(
  isoTimestamp: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!isoTimestamp) return null;
  const used = new Date(isoTimestamp);
  if (Number.isNaN(used.getTime())) return null;

  const elapsedMs = now.getTime() - used.getTime();
  // A clock skewed a little into the future is not worth a special sentence;
  // it reads as "just now", which is what it almost certainly was.
  const days = Math.floor(Math.max(0, elapsedMs) / 86_400_000);

  if (days === 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  if (days < 30) return `Last used ${days} days ago`;
  return `Last used ${used.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
