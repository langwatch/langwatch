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
 * The connection id this request is about, from the path.
 *
 * `/sso/callback/:providerId` and `/sso/saml2/sp/acs/:providerId` both carry
 * it, and for us a provider id IS a connection id — the projection keys the
 * engine's row on it.
 */
function connectionIdInPath(pathname: string): string | null {
  const match =
    /\/sso\/callback\/([^/?#]+)/.exec(pathname) ??
    /\/sso\/saml2\/sp\/acs\/([^/?#]+)/.exec(pathname);
  return match?.[1] ?? null;
}

/** The same, from a sign-in body, without consuming the caller's stream. */
async function connectionIdInBody(request: Request): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as {
      providerId?: unknown;
    } | null;
    const providerId = body?.providerId;
    return typeof providerId === "string" && providerId.length > 0
      ? providerId
      : null;
  } catch {
    return null;
  }
}

/**
 * The issuers to trust FOR THIS REQUEST, rather than every issuer we hold.
 *
 * `trustedOrigins` is not only the discovery allowlist this file's docstring
 * describes. better-auth's `originCheckMiddleware` runs the same list against
 * the `Origin` header of every cookie-bearing POST and against
 * `callbackURL` / `redirectTo` / `errorCallbackURL`. So handing it every
 * customer's issuer made one tenant's registered origin a valid CSRF origin
 * and a valid redirect target on the single sign-on endpoints — for every
 * other tenant.
 *
 * Scoping it to the connection the request names removes that entirely: what
 * is left is "you may be redirected to an origin you registered yourself",
 * which is not an escalation, because you already control it.
 *
 * A request that names no connection falls back to the whole set. That is
 * the domain-first sign-in, where the issuer is not known until the domain
 * is resolved — it still needs the discovery fetch to be allowed, and it
 * carries no caller-supplied redirect that the narrow set would protect.
 */
export async function issuersForRequest(
  request: Request | undefined,
): Promise<string[]> {
  if (!isSingleSignOnRequest(request) || !request?.url) return [];

  let named: string | null = null;
  try {
    named = connectionIdInPath(new URL(request.url).pathname);
  } catch {
    named = null;
  }
  named ??= await connectionIdInBody(request);
  if (named === null) return registeredIssuers();

  const only = await issuerForConnection(named);
  return only === null ? [] : [only];
}

/**
 * One connection's issuer, read fresh.
 *
 * NOT cached with the rest, and the comment used to say it was. This is the
 * common path — every `/sso/callback/:providerId` and SAML ACS names a
 * connection — so it is the read that most looked like it was collapsed by
 * the five-second window above and never was. Left uncached deliberately
 * rather than fixed silently: a connection registered a moment ago has to be
 * dialable immediately, and one row by unique key is a cheap query. The
 * module docstring's claim about collapsing bursts is about
 * `registeredIssuers()`, which fans out over every row.
 */
async function issuerForConnection(
  connectionId: string,
): Promise<string | null> {
  try {
    const row = await prisma.ssoProvider.findFirst({
      where: { providerId: connectionId },
      select: { issuer: true },
    });
    return row?.issuer ?? null;
  } catch (error) {
    logger.warn(
      { error, connectionId },
      "could not read the single sign-on issuer for this request",
    );
    return null;
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
