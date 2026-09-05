/**
 * What a shell host does when the query it is built on refuses.
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
  return { departing: false, copy: resolveUiFailureCopy({ error, fallbackTitle }) };
}
