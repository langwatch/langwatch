import "@langwatch/design-system-internal/styles.css";
import { initTheme, ToastProvider } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StorageConsole } from "./storage-console.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the console page has no #root element");

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <StorageConsole />
    </ToastProvider>
  </StrictMode>,
);
