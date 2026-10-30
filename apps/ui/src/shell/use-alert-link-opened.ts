/**
 * Counts a landing from an alert's link: once the reader is signed in, a page whose query carries
 * the alert marker sends `automations.opened.alert_link` once, then the marker is replaced out of
 * the current history entry, so Back, a reload or a copied link does not carry it again.
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
import { useLocation } from "react-router";

/** Sends one alert-link landing and drops the marker; mounted beside the analytics identity. */
export function useAlertLinkOpened(): void {
  const analytics = useUiAnalytics();
  const signedIn = useSession().user?.id !== undefined;
  const { pathname, search } = useLocation();
  const counted = useRef<string | undefined>(void 0);

  useEffect(() => {
    if (!signedIn || !isAlertLinkSearch(search)) return;
    const landing = `${pathname}${search}`;
    if (counted.current === landing) return;
    counted.current = landing;
    analytics.track(alertLinkOpened({ landedOn: alertLinkLandingOf(pathname) }));
    // Replaced in place, keeping the router's own entry state: no new entry for Back to find.
    const address = new URL(window.location.href);
    address.searchParams.delete(ALERT_LINK_PARAM);
    window.history.replaceState(window.history.state, "", address);
  }, [analytics, signedIn, pathname, search]);
}
