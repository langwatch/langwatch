import "@langwatch/design-system-internal/styles.css";
import { initTheme } from "@langwatch/design-system-internal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PaymentConsole } from "./payment-console.tsx";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("the console page has no #root element");

createRoot(root).render(
  <StrictMode>
    <PaymentConsole />
  </StrictMode>,
);
