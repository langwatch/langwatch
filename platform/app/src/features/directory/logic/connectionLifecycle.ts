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

/** The one lifecycle state in which a connection routes anybody. */
const LIVE_STATE = "ACTIVE";

/**
 * Whether a connection is live — the state in which sign-ins route through it
 * and a provider working against it does anything.
 *
 * Narrower than isRunningConnection, and deliberately so: that one answers
 * "is this still one of the organization's directories", which keeps a draft
 * or a claim awaiting approval in a list a reader is entitled to see whole.
 * This one answers "can a provider work through it yet", which is what the
 * token dialog is asking. A token issued against a connection that does not
 * route provisions nobody, so offering that connection is offering a dead end
 * — and the administrator only finds out much later, at the provider, with a
 * token that authenticates and syncs nothing.
 */
export function isActiveConnection({
  connectionState,
}: {
  connectionState: string;
}): boolean {
  return connectionState === LIVE_STATE;
}
