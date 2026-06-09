import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { OuterProviders } from "./AppProviders";
import { router } from "./routes";
import {
  registerChunkReloadListener,
  registerDeployWatcher,
} from "./utils/chunkReload";
import { setRouterInstance } from "./utils/compat/next-router";
import "nprogress/nprogress.css";
import "./styles/globals.scss";

// Enable imperative navigation from outside React (e.g. navigateToDrawer)
setRouterInstance(router);

// Recover from stale content-hashed chunks after a deploy. Reactively: when a
// lazy import() 404s, reload for the newer build instead of dead-ending on the
// "Failed to fetch dynamically imported module" error boundary. Proactively:
// reload a tab left open across a deploy when it next becomes visible, before
// the user can navigate into a purged chunk.
registerChunkReloadListener();
registerDeployWatcher();

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <OuterProviders>
    <Suspense fallback={null}>
      <RouterProvider router={router} />
    </Suspense>
  </OuterProviders>,
);
