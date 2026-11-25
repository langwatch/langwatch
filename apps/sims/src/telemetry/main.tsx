import "@langwatch/time/polyfill";
import "@langwatch/design-system-internal/styles.css";
import { initTheme } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TelemetryConsole } from "./telemetry-console.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the console page has no #root element");

createRoot(root).render(
  <StrictMode>
    <TelemetryConsole />
  </StrictMode>,
);
