import type { JoinRequestOrigin } from "@langwatch/identity";

/** The device-approval page `langwatch login` opens, which sends a new
 *  account through the welcome screen with itself as the continuation. */
const CLI_DEVICE_APPROVAL_PATH = "/cli/auth";

/**
 * Where a join request made from the welcome screen is coming from (ADR-143
 * v6): `cli` when the screen was reached with the device-approval page as its
 * continuation, `web` otherwise.
 *
 * Read off the continuation rather than off a stored flag because the
 * continuation is the one thing that provably came from the terminal: the
 * device page put it there, and the welcome screen only honours it when it
 * is a path on this site. The origin can only ever LOWER the seat a request
 * lands in, so deciding it in the browser costs nothing if a client lies.
 */
export function joinOriginOf({
  returnTo,
}: {
  returnTo: string | null | undefined;
}): JoinRequestOrigin {
  if (typeof returnTo !== "string") return "web";
  return returnTo === CLI_DEVICE_APPROVAL_PATH ||
    returnTo.startsWith(`${CLI_DEVICE_APPROVAL_PATH}?`)
    ? "cli"
    : "web";
}
