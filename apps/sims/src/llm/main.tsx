import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import { initTheme } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LlmConsole } from "./llm-console.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the console page has no #root element");

createRoot(root).render(
  <StrictMode>
    <LlmConsole />
  </StrictMode>,
);
