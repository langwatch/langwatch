/**
 * Counts a landing from an alert's link: a signed-in reader's page whose query carries the alert
 * marker sends `automations.opened.alert_link` once, then the router replaces the current entry
 * without it, so Back, a reload, a copied link or a later search update does not carry it.
 * @see modules/automation/specs/alert-link-opened.feature
 */
import {
  ALERT_LINK_PARAM,
  alertLinkLandingOf,
  alertLinkOpened,
  isAlertLinkSearch,
} from "@langwatch/automation-contract/alert-link";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useSession } from "@langwatch/browser-host/session";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

/** Sends one alert-link landing and drops the marker; mounted beside the analytics identity. */
export function useAlertLinkOpened(): void {
  const analytics = useUiAnalytics();
  const signedIn = useSession().user?.id !== undefined;
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const counted = useRef<string | undefined>(void 0);

  useEffect(() => {
    if (!signedIn || !isAlertLinkSearch(search)) return;
    const landing = `${pathname}${search}`;
    if (counted.current === landing) return;
    counted.current = landing;
    analytics.track(alertLinkOpened({ landedOn: alertLinkLandingOf(pathname) }));
    const stripped = new URLSearchParams(search);
    stripped.delete(ALERT_LINK_PARAM);
    const rest = stripped.toString();
    // Through the router, so its location loses the marker too; the same entry, keeping its state.
    void navigate({ pathname, search: rest ? `?${rest}` : "", hash }, { replace: true, state });
  }, [analytics, signedIn, pathname, search, hash, state, navigate]);
}
