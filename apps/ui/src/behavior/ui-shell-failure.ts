/**
 * What a shell host does when the query it is built on refuses.
 *
 * The organization graph is what every host reads its scope, its project and
 * its organization off, so a host that only reads `isLoading` is told the
 * graph settled and holds nothing — and renders the "nothing to show" branch,
 * which is an empty document. A refusal is a state, and there are two of them:
 * the caller is not (or is no longer) signed in, which is the session failure
 * path; or the read failed for some other reason, which is copy the reader can
 * act on plus the trace id they can quote.
 *
 * Spec: specs/auth/session-failure.feature
 */

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useEffect } from "react";

import { useUiAddress } from "./ui-address";
import { uiLeaveTo } from "./ui-departure";
import { resolveUiFailureCopy, type ResolvedUiFailureCopy } from "./ui-feedback";
import { useUiRouteReading } from "./ui-scope-route";
import { UI_SIGN_IN_PATH } from "./ui-session";

/**
 * Whether this refusal means "we do not know who you are".
 *
 * A 401 off any transport, and `session_read_failed`, which is the session
 * endpoint's own refusal: both leave the reader with no session to render the
 * shell for, and the answer to both is the sign-in screen.
 */
export function isUiSessionRefusal(error: unknown): boolean {
  const handled = readHandledError(error);
  if (handled) return handled.code === "session_read_failed" || handled.httpStatus === 401;

  const data = (error as { data?: { httpStatus?: unknown; code?: unknown } } | null)?.data;
  return data?.httpStatus === 401 || data?.code === "UNAUTHORIZED";
}

/**
 * Where a shell whose graph refused sends the reader, or null to stay and
 * render the failure. The same rule `uiSignedOutDeparture` applies: the
 * sign-in screen carrying the address asked for, never onboarding, and never
 * from a public route or an offline browser, where sign-in cannot help.
 */
export function uiShellFailureDeparture({
  error,
  isPublicRoute,
  isOnline,
  address,
}: {
  error: unknown;
  isPublicRoute: boolean;
  isOnline: boolean;
  address: string;
}): string | null {
  if (!error || isPublicRoute || !isOnline) return null;
  if (!isUiSessionRefusal(error)) return null;
  return `${UI_SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(address)}`;
}

/**
 * What a host does instead of rendering its children.
 *
 * `departing` is a full page load already in flight, so the host waits rather
 * than painting a shell the reader is leaving. `copy` is the failure to show.
 */
export type UiShellFailureState = {
  readonly departing: boolean;
  readonly copy: ResolvedUiFailureCopy | null;
};

export function useUiShellFailure({
  error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle: string;
}): UiShellFailureState {
  const address = useUiAddress();
  const route = useUiRouteReading();

  const departure = uiShellFailureDeparture({
    error,
    isPublicRoute: route.isPublicRoute,
    isOnline: navigator.onLine,
    address,
  });

  useEffect(() => {
    if (departure === null) return;
    uiLeaveTo(departure);
  }, [departure]);

  if (departure !== null) return { departing: true, copy: null };
  if (!error) return { departing: false, copy: null };
  return { departing: false, copy: resolveUiFailureCopy({ error, fallbackTitle }) };
}
