import { createLogger } from "@langwatch/observability";
import { prisma } from "~/server/db";

/**
 * The issuers this installation's customers have registered.
 *
 * These are what make a discovery fetch trusted (see `trustedOrigins.ts`):
 * an organization administrator registering an identity provider is the
 * declaration that we may talk to it, so the set of connections we hold IS
 * the allowlist.
 *
 * TWO THINGS KEEP THIS OFF THE HOT PATH.
 *
 * Only single sign-on requests ask. Every other `/api/auth/*` request — every
 * session read, every password sign-in, every passkey ceremony — resolves its
 * trusted origins from configuration alone and never touches the database,
 * because none of them fetch an issuer.
 *
 * And the answer is cached for a few seconds. A sign-in is several requests
 * that each resolve the list, and re-reading the same handful of rows for
 * each of them would turn one ceremony into a burst of identical queries.
 * The window is short enough that a connection registered a moment ago works
 * on the customer's first attempt, which is the case that matters: they are
 * standing on the setup screen when they press it.
 */

const logger = createLogger("langwatch:better-auth:registered-issuers");

/** Long enough to collapse one ceremony's requests, short enough that a
 *  just-registered connection is usable immediately. */
const CACHE_TTL_MS = 5_000;

let cached: { at: number; issuers: string[] } | null = null;

/**
 * Whether this request could need an issuer fetched.
 *
 * Matched on the path rather than the method: the plugin's sign-in, callback
 * and registration routes all live under the same segment, and a check that
 * tried to enumerate them would go stale the first time one was renamed.
 */
export function isSingleSignOnRequest(request: Request | undefined): boolean {
  if (!request?.url) return false;
  try {
    return new URL(request.url).pathname.includes("/sso");
  } catch {
    return false;
  }
}

/**
 * Every registered issuer, or an empty list if we cannot read them.
 *
 * A read that fails must NOT take the whole auth request down with it: the
 * cost of answering with the configured origins alone is one refused single
 * sign-in with a message naming the trust problem, and the cost of throwing
 * is every sign-in of every kind failing. It is logged at warn, because a
 * database this cannot reach is a real fault even though it degrades here.
 */
export async function registeredIssuers(): Promise<string[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.issuers;

  try {
    const rows = await prisma.ssoProvider.findMany({
      select: { issuer: true },
    });
    const issuers = rows
      .map((row) => row.issuer)
      .filter((issuer): issuer is string => !!issuer);
    cached = { at: now, issuers };
    return issuers;
  } catch (error) {
    logger.warn(
      { error },
      "could not read registered single sign-on issuers; falling back to the configured trusted origins",
    );
    return cached?.issuers ?? [];
  }
}
