import { createRoot, hydrateRoot } from "react-dom/client";

import type { HighlightedExamples } from "./api/operation.ts";
import { App } from "./app.tsx";
import { loadOperation, loadPage } from "./pages.ts";

declare global {
  interface Window {
    __DOCS_SLUG__?: string;
    __DOCS_EXAMPLES__?: HighlightedExamples;
  }
}

const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
const slug = window.__DOCS_SLUG__ ?? (path === "" ? "introduction" : path);
const [page, operation] = await Promise.all([loadPage({ slug }), loadOperation({ slug })]);
const root = document.getElementById("root");
if (root) {
  const app = (
    <App slug={slug} page={page} operation={operation} examples={window.__DOCS_EXAMPLES__} />
  );
  if (root.firstElementChild) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
