import { hydrateRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { loadPage } from "./pages.ts";

declare global {
  interface Window {
    __DOCS_SLUG__?: string;
  }
}

const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
const slug = window.__DOCS_SLUG__ ?? (path === "" ? "introduction" : path);
const page = await loadPage({ slug });
const root = document.getElementById("root");
if (root) hydrateRoot(root, <App slug={slug} page={page} />);
