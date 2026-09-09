/**
 * What every discovery location does when it is asked for a credential, and
 * what it answers when something fails. Shared by the mounts so the locations
 * cannot drift in their refusals any more than they can in their bytes.
 */
import type { RestErrorHandler } from "@langwatch/api/rest";

/**
 * The description is read without authenticating, so the door resolves nothing.
 * Reaching this is a mount that lost its `publicRoute` access, not a request.
 */
export function noDiscoveryCredential(): never {
  throw new Error("A discovery location answers with no credential resolved.");
}

/**
 * The flat legacy body the process has always published for these paths. An
 * unanticipated failure never puts its own message in front of a caller, and
 * the document these routes serve carries no tenant data to leak in one.
 */
export const discoveryErrors: RestErrorHandler = (_error, context) =>
  context.json({ error: "Internal Server Error", message: "An unknown error occurred" }, 500);
