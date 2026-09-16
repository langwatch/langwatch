import { createLogger } from "@langwatch/observability";
import {
  GENERIC_SIGN_IN_ERROR_CODE,
  signInErrorMayCross,
} from "~/features/auth/logic/signInErrorCodes";

const logger = createLogger("langwatch:better-auth:signin-error-redirect");

/**
 * The query parameters that survive a withheld failure.
 *
 * An allowlist rather than a list of things to strip, because the direction
 * matters: a parameter better-auth adds in a later version is withheld by
 * default instead of travelling until somebody notices it. `callbackUrl` is
 * here because the error card's own recovery action reads it to send somebody
 * back where they were going.
 */
const CARRIED_THROUGH = ["callbackUrl"] as const;

/**
 * A failed sign-in's redirect, with only what we are willing to say in it.
 *
 * WHY A RESPONSE AND NOT A HOOK. better-auth builds these redirects in a
 * dozen places deep inside its OAuth and SSO callbacks — `redirectOnError`,
 * the proxy plugin, the state machine — and each one appends its own code and
 * its own prose to whatever `onAPIError.errorURL` names. There is no seam
 * inside the library that sees all of them. There IS one place every single
 * one passes through on its way out, which is the route that owns the
 * handler, so that is where the boundary lives. It reads the answer rather
 * than trying to intercept its construction, which means a redirect built by
 * a path nobody has thought about yet is still covered.
 *
 * THE RULE, in one line: only a refusal we have written down crosses. One we
 * have — a code a screen renders copy for — travels as that code, and its
 * description travels with it, because on one of them
 * (`SSO_REQUIRED_BY_ORGANIZATION`) the description IS the connection to bounce
 * to. Everything else becomes `sign_in_failed` with no description at all,
 * and the real cause goes to the log with the trace id instead.
 *
 * Non-redirects, redirects somewhere else, and redirects carrying no `error`
 * are returned untouched — this rewrites a Location, and nothing else about
 * the answer.
 *
 * Spec: specs/identity/sso-signin-error-boundary.feature
 */
export function withholdInternalSignInError({
  response,
  errorPageUrl,
  traceId,
}: {
  response: Response;
  /** Where a failed sign-in is sent — `onAPIError.errorURL`. */
  errorPageUrl: string;
  /** The request's own trace id, so the log line and the screen agree. */
  traceId?: string | null;
}): Response {
  if (response.status < 300 || response.status >= 400) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  let target: URL;
  let errorPage: URL;
  try {
    // `errorPageUrl` is absolute, so it is also the base a relative Location
    // resolves against — better-auth emits both shapes.
    errorPage = new URL(errorPageUrl);
    target = new URL(location, errorPage);
  } catch {
    // A Location we cannot parse is one we cannot rewrite, and refusing to
    // serve it would break a redirect that is very probably fine.
    return response;
  }

  // Only the sign-in error page. A callback redirecting somebody onward to
  // the application they were signing in to is not this boundary's business.
  if (target.origin !== errorPage.origin) return response;
  if (target.pathname !== errorPage.pathname) return response;

  const code = target.searchParams.get("error");
  if (!code) return response;
  if (signInErrorMayCross(code)) return response;

  const description = target.searchParams.get("error_description");

  // THE HALF THAT WAS MISSING ENTIRELY. This failure produced no server log
  // line at all, so the only way to learn what had happened was to read the
  // URL off somebody's screen — which is why the native-transaction error
  // survived from the day single sign-on shipped. It is an error rather than
  // a warning because, unlike a refusal, nobody decided this: it is a failure
  // we did not anticipate, and it is ours.
  logger.error(
    { code, description, traceId: traceId ?? null, path: target.pathname },
    "a sign-in failed for a reason we have not written down; the person was sent a generic refusal",
  );

  const withheld = new URL(errorPage);
  for (const carried of CARRIED_THROUGH) {
    const value = target.searchParams.get(carried);
    if (value !== null) withheld.searchParams.set(carried, value);
  }
  withheld.searchParams.set("error", GENERIC_SIGN_IN_ERROR_CODE);
  // The one thing worth carrying about a cause we will not name: the handle
  // that ties what the person is looking at to the line we just wrote.
  if (traceId) withheld.searchParams.set("trace", traceId);

  const headers = new Headers(response.headers);
  headers.set("location", withheld.toString());
  return new Response(response.body, { status: response.status, headers });
}
