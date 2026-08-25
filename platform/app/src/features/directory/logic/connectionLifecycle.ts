/** The lifecycle states in which a connection has left for good. */
const RETIRED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/**
 * Whether a connection is still one of this organization's directories.
 *
 * Shared rather than asked twice, because two surfaces read the same list and
 * a retired connection means the same thing on both: it provisions nobody, its
 * tokens do nothing, and the last time it pushed is not "last sync". The
 * Directory page keeps it under its own heading — the people it created are
 * still members, and that is exactly the question somebody has when they find
 * it — and every summary of what the directory is DOING leaves it out.
 *
 * Counting it was what put "+1 more" beside two live sources and made an
 * administrator with one working directory look like one with three.
 */
export function isRunningConnection({
  connectionState,
}: {
  connectionState: string;
}): boolean {
  return !RETIRED_STATES.has(connectionState);
}
