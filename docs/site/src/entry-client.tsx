import { hydrateRoot } from "react-dom/client";
import { App } from "./app.tsx";
import type { HighlightedExamples } from "./api/operation.ts";
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
if (root) hydrateRoot(root, <App slug={slug} page={page} operation={operation} examples={window.__DOCS_EXAMPLES__} />);
