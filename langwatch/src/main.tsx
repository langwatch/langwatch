import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { OuterProviders } from "./AppProviders";
import "./styles/globals.scss";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <OuterProviders>
    <Suspense>
      <RouterProvider router={router} />
    </Suspense>
  </OuterProviders>
);
