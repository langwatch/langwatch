/**
 * Who is signed in, via BetterAuth's client. Reads `/session`, the
 * deployment's impersonation-aware endpoint, not BetterAuth's own
 * `/get-session` — an impersonating admin must see the customer's screens.
 */

import { createAuthClient } from "better-auth/react";
import { HandledError } from "@langwatch/handled-error";
import type { UiActor } from "./ui-capabilities";

/** The session endpoint, relative to the auth client's own base URL. */
export const UI_SESSION_PATH = "/session";

/** The cache key the session read is kept under. Not a tRPC procedure. */
export const UI_SESSION_QUERY_KEY: readonly string[] = ["langwatch-ui", "auth", "session"];

/**
 * As much of the auth client as a session read uses — structural, so the
 * real client satisfies it without a cast and a test can fake it.
 */
export type UiAuthClient = {
  $fetch: (path: string) => Promise<{ data?: unknown; error?: unknown }>;
  /**
   * Ends the session. Declared here because this client is the ONE
   * identity instance in the document — a governed web package may not
   * construct its own (`frontend-ui-boundaries` names `better-auth`).
   */
  signOut: () => Promise<unknown>;
};

let sharedClient: UiAuthClient | undefined;

/**
 * The one client per document — built on first use, not module scope,
 * since constructing it resolves the base URL from `window.location` and
 * an entry point that does that on import can't load anywhere else.
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
 * The signed-in user, or null when nobody is — a payload with no user id
 * is not a user, whatever shape the endpoint answered with.
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

/**
 * Fire-and-forget: the endpoint clears the cookie, and what the reader
 * sees next is decided by their redirect, not this promise. A refusal
 * leaves them signed in, which the next session read reports on its own.
 */
export async function signOutUi(client: UiAuthClient = uiAuthClient()): Promise<void> {
  await client.signOut();
}

/**
 * The read failed, so who is here is not known. Named rather than thrown as
 * a plain Error because the reader is about to be treated as signed out and
 * is owed the reason — `session_read_failed` carries the words they read.
 */
export class SessionReadFailedError extends HandledError {
  declare readonly code: "session_read_failed";

  constructor(cause: unknown) {
    super("session_read_failed", "The session endpoint refused the read.", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
      ...(cause instanceof Error ? { reasons: [cause] } : {}),
    });
    this.name = "SessionReadFailedError";
  }
}

/**
 * One session read. A refusal resolves to signed out with the failure
 * attached rather than rejecting: an unanswered session is what leaves the
 * shell on an empty document, and "we could not tell" has to route somewhere.
 */
export type UiSessionReading = {
  readonly actor: UiActor | null;
  /** The refusal, when there was one. Nobody is signed in either way. */
  readonly failure: SessionReadFailedError | null;
};

export async function readUiActor(
  client: UiAuthClient = uiAuthClient(),
): Promise<UiSessionReading> {
  try {
    const response = await client.$fetch(UI_SESSION_PATH);
    if (response.error) {
      return { actor: null, failure: new SessionReadFailedError(response.error) };
    }
    return { actor: toUiActor(response.data), failure: null };
  } catch (error) {
    return { actor: null, failure: new SessionReadFailedError(error) };
  }
}
