/**
 * Who is signed in, read from the deployment this page was served by.
 *
 * The client is BetterAuth's, configured the way the application configures
 * its own: same origin, no `baseURL` of its own to get wrong, and no plugins,
 * because none of the application's plugins take part in a session read — the
 * passkey plugin it declares is for the sign-in screens, which are not this
 * slice.
 *
 * What it reads is `/session`, not BetterAuth's own `/get-session`. That is
 * the deployment's impersonation-aware endpoint: it resolves the session
 * server-side and rewrites the user to the impersonated identity, which the
 * raw endpoint does not. An admin impersonating a customer must see the
 * customer's screens, so reading the raw session here would quietly show them
 * their own.
 */

import { createAuthClient } from "better-auth/react";
import type { UiActor } from "./ui-capabilities";

/** The session endpoint, relative to the auth client's own base URL. */
export const UI_SESSION_PATH = "/session";

/** The cache key the session read is kept under. Not a tRPC procedure. */
export const UI_SESSION_QUERY_KEY: readonly string[] = ["langwatch-ui", "auth", "session"];

/**
 * As much of the auth client as a session read uses.
 *
 * Structural, so the real client satisfies it without a cast and a test can
 * answer with a recorded payload instead of a server.
 */
export type UiAuthClient = {
  $fetch: (path: string) => Promise<{ data?: unknown; error?: unknown }>;
};

let sharedClient: UiAuthClient | undefined;

/**
 * The one client per document.
 *
 * Built on first use rather than at module scope: constructing it resolves the
 * base URL from `window.location`, and a package entry point that does that on
 * import cannot be loaded anywhere else.
 */
export function uiAuthClient(): UiAuthClient {
  sharedClient ??= createAuthClient({});
  return sharedClient;
}

/** The session payload the deployment's impersonation-aware endpoint returns. */
type UiSessionPayload = {
  user?: {
    id?: unknown;
    name?: unknown;
    email?: unknown;
    image?: unknown;
  };
};

function readableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The signed-in user, or null when nobody is.
 *
 * A payload without a user id is not a user: the endpoint answers `null` for a
 * signed-out reader, and anything else it could answer with no id is a shape
 * this cannot act on either way.
 */
export function toUiActor(payload: unknown): UiActor | null {
  if (!payload || typeof payload !== "object") return null;
  const user = (payload as UiSessionPayload).user;
  if (!user || typeof user !== "object") return null;
  const id = readableString(user.id);
  if (id === null) return null;
  return {
    id,
    name: readableString(user.name),
    email: readableString(user.email),
    image: readableString(user.image),
  };
}

/** One session read, over the client's own transport. */
export async function readUiActor(client: UiAuthClient = uiAuthClient()): Promise<UiActor | null> {
  const response = await client.$fetch(UI_SESSION_PATH);
  if (response.error) {
    throw new Error("The session endpoint refused the read.", { cause: response.error });
  }
  return toUiActor(response.data);
}
