/**
 * What a shell host does when the query it is built on refuses.
 * Spec: specs/auth/session-failure.feature
 */

import { UI_SIGN_IN_PATH } from "@langwatch/auth-browser/session-capability";
import { useUiAddress } from "@langwatch/browser-host/address";
import { resolveUiFailureCopy, type ResolvedUiFailureCopy } from "@langwatch/browser-host/feedback";
import { isUiNavigatingAway, uiLeaveTo } from "@langwatch/browser-host/navigation";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { useUiRouteReading } from "@langwatch/organization-browser/surfaces/scope-capability";
import { useEffect } from "react";

/**
 * Whether this refusal means "we do not know who you are".
 */
export function isUiSessionRefusal(error: unknown): boolean {
  const handled = readHandledError(error);
  if (handled) return handled.code === "session_read_failed" || handled.httpStatus === 401;

  const data = (error as { data?: { httpStatus?: unknown; code?: unknown } } | null)?.data;
  return data?.httpStatus === 401 || data?.code === "UNAUTHORIZED";
}

/**
 * Where a shell whose graph refused sends the reader, or null to stay and render the
 * failure.
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
  // Already leaving, by an earlier decision of this or another host: the graph
  // failing now is the unload aborting its requests, not a shell that cannot
  // load. Reported as departing so nothing is drawn over the page on its way
  // out.
  if (isUiNavigatingAway()) return { departing: true, copy: null };
  return { departing: false, copy: resolveUiFailureCopy({ error, fallbackTitle }) };
}
