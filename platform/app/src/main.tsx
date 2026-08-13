import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { OuterProviders } from "./AppProviders";
import { router } from "./routes";
import { registerChunkReloadListener } from "./utils/chunkReload";
import { setRouterInstance } from "./utils/compat/next-router";
import "nprogress/nprogress.css";
import "./styles/globals.scss";

// Enable imperative navigation from outside React (e.g. navigateToDrawer)
setRouterInstance(router);

// Recover from stale content-hashed chunks after a deploy: when a lazy import()
// 404s (e.g. the trace-drawer JSON viewer), reload once to fetch the new hashes
// instead of dead-ending on the "Failed to fetch dynamically imported module"
// error boundary.
registerChunkReloadListener();

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <OuterProviders>
    <Suspense fallback={null}>
      {/* Lazy routes and drawers subscribe to external stores. Transition-wrapped
          navigation can advance history while leaving the old tree committed. */}
      <RouterProvider router={router} useTransitions={false} />
    </Suspense>
  </OuterProviders>,
);
