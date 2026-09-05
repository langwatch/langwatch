/**
 * First-touch attribution capture, the WRITE half of `./attribution`. Mounted at the
 * application's outermost provider position so it runs on every landing URL — the
 * unauthenticated ones included — before any navigation can drop the query string.
 */

import { useEffect } from "react";
import { type AttributionField, setAttributionIfAbsent, URL_PARAM_TO_FIELD } from "./attribution";

/**
 * Drops the query and fragment so a referrer's own parameters never travel
 * onward. Returns null when the referrer is not a URL.
 */
function sanitizeReferrer(referrer: string): string | null {
  try {
    const url = new URL(referrer);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function useAttributionCapture(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    for (const [urlParam, field] of Object.entries(URL_PARAM_TO_FIELD) as [
      string,
      AttributionField,
    ][]) {
      const value = params.get(urlParam);
      if (value) setAttributionIfAbsent(field, value);
    }

    const referrer = document.referrer ? sanitizeReferrer(document.referrer) : null;
    if (referrer) setAttributionIfAbsent("referrer", referrer);
  }, []);
}
