import { Temporal } from "@langwatch/time";

/** The prompt note for a person past the per-day pull request cap: refuse to open another. */
export function langyPrCapReachedNote({
  perDayPrCap,
  resetAt,
}: {
  perDayPrCap: number;
  resetAt: number;
}): string {
  return [
    "",
    "USER PR CAP REACHED — the user has already opened the per-day maximum",
    "of",
    String(perDayPrCap),
    "GitHub pull requests via Langy today.",
    "If the user asks you to open a PR, refuse politely, say the daily cap",
    "is reached, and that it resets at",
    Temporal.Instant.fromEpochMilliseconds(resetAt).toString({ fractionalSecondDigits: 3 }),
    "UTC.",
    "Do not call any tool that opens a PR.",
  ].join(" ");
}

/** How the worker takes a turn: revive a parked one, create a session, or continue the live one. */
export function langyDispatchIntentOf({
  resumable,
  hasApiKey,
}: {
  resumable: boolean;
  hasApiKey: boolean;
}): "create" | "revive" | "continue" {
  if (resumable) return "revive";
  return hasApiKey ? "create" : "continue";
}
