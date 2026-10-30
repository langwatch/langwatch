/**
 * Who is signed in, via BetterAuth's client. Reads `/session`, the
 * deployment's impersonation-aware endpoint, not BetterAuth's own
 * `/get-session` — an impersonating admin must see the customer's screens.
 */

import type { UiAuthClient } from "@langwatch/auth-contract";
import type { UiActor } from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";
import { clearPersistedUiQueries } from "@langwatch/browser-host/query-persistence";
import { clearReaderUiStorage, clearSessionUiStorage } from "@langwatch/browser-host/storage";
import { createAuthClient } from "better-auth/react";

/** The session endpoint, relative to the auth client's own base URL. */
export const UI_SESSION_PATH = "/session";

/**
 * The one route that ends the browser's session: a whole-page GET, because only
 * it federates the logout out to the deployment's identity provider. Better
 * Auth's own `POST /sign-out` clears our cookie and leaves theirs standing.
 */
export const UI_SIGN_OUT_PATH = "/api/auth/logout";

/** The cache key the session read is kept under. Not a tRPC procedure. */
export const UI_SESSION_QUERY_KEY: readonly string[] = ["langwatch-ui", "auth", "session"];

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
    impersonator?: unknown;
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
    impersonator: readImpersonator(user.impersonator),
  };
}

/** The operator acting as this user, so the shell can show its banner; absent when nobody is. */
function readImpersonator(value: unknown): UiActor["impersonator"] {
  if (!value || typeof value !== "object") return undefined;
  const id = readableString((value as { id?: unknown }).id);
  if (id === null) return undefined;
  return { id, email: readableString((value as { email?: unknown }).email) };
}

/** The keys the reader's mirrored reads are sealed under, this epoch's and the last. */
function toUiCacheKeys(payload: unknown): Pick<UiSessionReading, "cacheKey" | "previousCacheKey"> {
  if (!payload || typeof payload !== "object") return { cacheKey: null, previousCacheKey: null };
  return {
    cacheKey: "cacheKey" in payload ? readableString(payload.cacheKey) : null,
    previousCacheKey:
      "previousCacheKey" in payload ? readableString(payload.previousCacheKey) : null,
  };
}

/**
 * This device forgets the reader, then the tab leaves for the logout route,
 * which also ends a federated provider's session and lands on sign in.
 * Spec: specs/auth/sign-out-leaves-the-page.feature
 */
export async function signOutUi(): Promise<void> {
  clearReaderUiStorage();
  clearSessionUiStorage();
  await clearPersistedUiQueries();
  uiLeaveTo(UI_SIGN_OUT_PATH);
}

/** The one status that answers "nobody is signed in" by refusing the read. */
const NOT_SIGNED_IN_STATUS = 401;

/**
 * One session read. Only an answer signs a reader out: a 401, or a reply naming
 * no user. Any other failure answered nothing, so the shell's reconnecting
 * screen holds the reader and reads again (specs/auth/session-failure.feature).
 */
export type UiSessionReading = {
  readonly actor: UiActor | null;
  /** Nothing answered who is here. The reader waits rather than leaves. */
  readonly unreachable: boolean;
  /** The keys the shell seals mirrored reads under; in memory only, as this read never mirrors. */
  readonly cacheKey: string | null;
  readonly previousCacheKey: string | null;
};

const UNREACHABLE: UiSessionReading = {
  actor: null,
  unreachable: true,
  cacheKey: null,
  previousCacheKey: null,
};

const SIGNED_OUT: UiSessionReading = {
  actor: null,
  unreachable: false,
  cacheKey: null,
  previousCacheKey: null,
};

function failedRead(cause: unknown): UiSessionReading {
  const isNotSignedIn =
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    cause.status === NOT_SIGNED_IN_STATUS;
  return isNotSignedIn ? SIGNED_OUT : UNREACHABLE;
}

export async function readUiActor(
  client: UiAuthClient = uiAuthClient(),
): Promise<UiSessionReading> {
  try {
    const response = await client.$fetch(UI_SESSION_PATH);
    if (response.error) return failedRead(response.error);
    return {
      actor: toUiActor(response.data),
      unreachable: false,
      ...toUiCacheKeys(response.data),
    };
  } catch (error) {
    return failedRead(error);
  }
}

/**
 * A re-read that fails keeps the answer already given, as main's session
 * cache did (`if (!res.ok) return _cachedSession`): a 403 elsewhere re-reads
 * the session, and a hiccup on that re-read must not sign anybody out.
 */
export function keepAnsweredReaderOnFailedReread({
  reading,
  previous,
}: {
  reading: UiSessionReading;
  previous: UiSessionReading | undefined;
}): UiSessionReading {
  if (!reading.unreachable || !previous || previous.unreachable) return reading;
  return previous;
}
