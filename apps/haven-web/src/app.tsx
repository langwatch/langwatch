import { ToastProvider } from "@langwatch/design-system-internal";
import { useCallback, useEffect, useState } from "react";

import { StackHomeApp } from "./home/stack-home-app.tsx";
import { HubApp, type Navigate } from "./hub/hub-app.tsx";
import { readRoute } from "./shared/route.ts";

const isHubPath = ({ pathname }: { pathname: string }) =>
  pathname === "/" || pathname === "/logs" || pathname.startsWith("/logs/");

/** The hub's two pages are one document: a same-origin link between them is a route change. */
const followsInApp = ({ event }: { event: MouseEvent }) => {
  if (event.defaultPrevented || event.button !== 0) return undefined;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.target !== "" ||
    anchor.hasAttribute("download")
  ) {
    return undefined;
  }
  if (anchor.origin !== window.location.origin || !isHubPath({ pathname: anchor.pathname })) {
    return undefined;
  }
  return `${anchor.pathname}${anchor.search}`;
};

const useLocationRoute = () => {
  const [route, setRoute] = useState(() => readRoute(window.location));
  const navigate: Navigate = useCallback(({ path, replace = false }) => {
    if (replace) window.history.replaceState(null, "", path);
    else {
      window.history.pushState(null, "", path);
      window.scrollTo({ top: 0 });
    }
    setRoute(readRoute(window.location));
  }, []);
  useEffect(() => {
    const onPop = () => setRoute(readRoute(window.location));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return { route, navigate };
};

export const App = () => {
  const { route, navigate } = useLocationRoute();
  const onHub = route.kind === "hub";
  useEffect(() => {
    if (!onHub) return;
    const onClick = (event: MouseEvent) => {
      const path = followsInApp({ event });
      if (path === undefined) return;
      event.preventDefault();
      navigate({ path });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [onHub, navigate]);

  return (
    <ToastProvider>
      {route.kind === "home" ? (
        <StackHomeApp slug={route.slug} />
      ) : (
        <HubApp route={route} navigate={navigate} />
      )}
    </ToastProvider>
  );
};
