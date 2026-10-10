/**
 * react-router's two hooks the drawer navigator reads, backed by the window's
 * own location and history state, so a test drives the real drawer hook and
 * reads the address bar the way a reload or Back would see it.
 */
import { useSyncExternalStore } from "react";

const LOCATION_CHANGE = "test-location-change";

function subscribe(onChange: () => void) {
  window.addEventListener(LOCATION_CHANGE, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(LOCATION_CHANGE, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const currentEntry = () => `${window.location.href}${JSON.stringify(window.history.state)}`;

/** Tells every mounted reader that the window's address changed under it. */
export function notifyLocationChange(): void {
  window.dispatchEvent(new Event(LOCATION_CHANGE));
}

/** Puts the window on an address, with the `state` a drawer stack would ride in. */
export function setWindowAddress({ url, state }: { url: string; state?: unknown }): void {
  window.history.replaceState({ usr: state ?? null }, "", url);
  notifyLocationChange();
}

/** Puts the window on an open trace drawer; `params` are its `drawer.<key>` values. */
export function openTraceDrawerAt({
  traceId = "trace-1",
  state,
  ...params
}: { traceId?: string; state?: unknown } & Record<string, string | undefined>): void {
  const query = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": traceId,
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(`drawer.${key}`, value);
  }
  setWindowAddress({ url: `/my-project/traces?${query}`, state });
}

export const windowLocationRouter = {
  useLocation: () => {
    useSyncExternalStore(subscribe, currentEntry);
    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: window.history.state?.usr ?? null,
      key: "default",
    };
  },
  useNavigate: () => (url: string, options?: { replace?: boolean; state?: unknown }) => {
    const entry = { usr: options?.state ?? null };
    if (options?.replace) window.history.replaceState(entry, "", url);
    else window.history.pushState(entry, "", url);
    notifyLocationChange();
  },
};
