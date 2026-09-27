/**
 * react-router's two hooks the drawer navigator reads, backed by the window's
 * own location, so a test drives the real drawer hook and reads the address bar.
 */
import { useSyncExternalStore } from "react";

const LOCATION_CHANGE = "test-location-change";

function subscribe(onChange: () => void) {
  window.addEventListener(LOCATION_CHANGE, onChange);
  return () => window.removeEventListener(LOCATION_CHANGE, onChange);
}

const currentHref = () => window.location.href;

export const windowLocationRouter = {
  useLocation: () => {
    useSyncExternalStore(subscribe, currentHref);
    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: null,
      key: "default",
    };
  },
  useNavigate: () => (url: string) => {
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event(LOCATION_CHANGE));
  },
};
