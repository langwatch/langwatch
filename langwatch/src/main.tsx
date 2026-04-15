import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { OuterProviders } from "./AppProviders";
import { setRouterInstance } from "./utils/compat/next-router";
import "nprogress/nprogress.css";
import "./styles/globals.scss";

// Enable imperative navigation from outside React (e.g. navigateToDrawer)
setRouterInstance(router);

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <OuterProviders>
    <Suspense fallback={null}>
      <RouterProvider router={router} />
    </Suspense>
  </OuterProviders>
);
