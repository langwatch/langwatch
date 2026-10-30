/**
 * Counts a landing from an alert's link: once the reader is signed in, a page whose query carries
 * the alert marker sends `automations.opened.alert_link` once, then the marker is dropped from the
 * address, so a reload or a shared link is not counted again.
 * @see modules/automation/specs/alert-link-opened.feature
 */
import {
  alertLinkLandingOf,
  alertLinkOpened,
  isAlertLinkSearch,
  searchWithoutAlertMarker,
} from "@langwatch/automation-contract";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useSession } from "@langwatch/browser-host/session";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

/** Sends one alert-link landing and drops the marker; mounted beside the analytics identity. */
export function useAlertLinkOpened(): void {
  const analytics = useUiAnalytics();
  const signedIn = useSession().user?.id !== undefined;
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!signedIn || !isAlertLinkSearch(search)) return;
    analytics.track(alertLinkOpened({ landedOn: alertLinkLandingOf(pathname) }));
    void navigate({ pathname, search: searchWithoutAlertMarker(search), hash }, { replace: true });
  }, [analytics, signedIn, pathname, search, hash, navigate]);
}
