import "@langwatch/time/polyfill";
import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import { initTheme, ToastProvider } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the simulator page has no #root element");

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App location={window.location} />
    </ToastProvider>
  </StrictMode>,
);
