// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The lifecycle states in which a connection has left for good. */
const RETIRED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/**
 * Whether a connection is still one of this organization's directories.
 * A retired one provisions nobody, its tokens do nothing, and the last time it
 * pushed is not "last sync". Counting it was what put "+1 more" beside two
 * live sources and made one working directory look like three.
 */
export function isRunningConnection({ connectionState }: { connectionState: string }): boolean {
  return !RETIRED_STATES.has(connectionState);
}

/** The one lifecycle state in which a connection routes anybody. */
const LIVE_STATE = "ACTIVE";

/**
 * Whether a provider can work through this connection yet — narrower than
 * `isRunningConnection`, which answers "is this still one of the
 * organization's directories". A token issued against a connection that does
 * not route provisions nobody, and the administrator only finds out much
 * later, at the provider, with a token that authenticates and syncs nothing.
 */
export function isActiveConnection({ connectionState }: { connectionState: string }): boolean {
  return connectionState === LIVE_STATE;
}

/**
 * Which connection a token is minted against. With exactly one to choose from
 * the choice is already made and asking is an errand; with several, nothing is
 * assumed — a token on the wrong connection has the wrong write authority.
 */
export function chosenConnectionOf({
  connectionId,
  issuableConnections,
}: {
  connectionId: string;
  issuableConnections: { connectionId: string }[];
}): string {
  if (connectionId) return connectionId;
  if (issuableConnections.length !== 1) return "";

  return issuableConnections[0]?.connectionId ?? "";
}
