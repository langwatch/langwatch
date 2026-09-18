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

/** Only recognized refusal codes may cross the sign-in error boundary. */
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
  const target = signInErrorTarget(response, errorPageUrl);
  if (!target) return response;

  const code = target.searchParams.get("error");
  if (!code) return response;
  if (signInErrorMayCross(code)) return response;

  const description = target.searchParams.get("error_description");

  logger.error(
    { code, description, traceId: traceId ?? null, path: target.pathname },
    "a sign-in failed for a reason we have not written down; the person was sent a generic refusal",
  );

  const withheld = new URL(errorPageUrl);
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

function signInErrorTarget(
  response: Response,
  errorPageUrl: string,
): URL | null {
  if (response.status < 300 || response.status >= 400) return null;

  const location = response.headers.get("location");
  if (!location) return null;

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
    return null;
  }

  // Only the sign-in error page. A callback redirecting somebody onward to
  // the application they were signing in to is not this boundary's business.
  if (target.origin !== errorPage.origin) return null;
  if (target.pathname !== errorPage.pathname) return null;

  return target;
}
