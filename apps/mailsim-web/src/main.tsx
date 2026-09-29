import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import { initTheme, ToastProvider } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Inbox } from "./inbox.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the inbox page has no #root element");

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <Inbox />
    </ToastProvider>
  </StrictMode>,
);
