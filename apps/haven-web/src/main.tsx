import "@langwatch/time/polyfill";
import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import { initTheme } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";

initTheme();
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
