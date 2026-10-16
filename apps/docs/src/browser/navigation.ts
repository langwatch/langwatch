import { docsBasePath } from "../config.ts";

const pages = new Map<string, { at: number; html: Promise<string> }>();
const positions = new Map<string, number>();
let current = location.href;
let navigating = 0;

/** The deferred prefetch island asks for a page; `result` settles once its HTML is cached. */
export type PrefetchRequest = { anchor: HTMLAnchorElement; result?: Promise<void> };

function pageUrl({ anchor }: { anchor: HTMLAnchorElement }): URL | null {
  const url = new URL(anchor.href);
  if (anchor.target || anchor.hasAttribute("download") || anchor.rel.includes("external"))
    return null;
  if (url.origin !== location.origin || url.search || /\.[a-z0-9]+$/i.test(url.pathname))
    return null;
  // Only this site's pages swap in place; the app beside a /docs mount is a full load.
  if (!`${url.pathname}/`.startsWith(`${docsBasePath}/`)) return null;
  if (url.pathname === location.pathname && url.hash) return null;
  return url;
}

async function fetchPage({ url }: { url: URL }) {
  const key = url.origin + url.pathname;
  const cached = pages.get(key);
  const now = performance.now();
  if (cached && now - cached.at < 30_000) return cached.html;
  const html = fetch(key, { credentials: "omit", headers: { Accept: "text/html" } }).then(
    async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
        throw new Error("Page unavailable");
      return response.text();
    },
  );
  pages.set(key, { at: now, html });
  if (pages.size > 12) pages.delete(pages.keys().next().value ?? "");
  try {
    return await html;
  } catch (error) {
    pages.delete(key);
    throw error;
  }
}

function prefetch({ event }: { event: Event }) {
  const request = (event as CustomEvent<PrefetchRequest>).detail;
  const url = pageUrl({ anchor: request.anchor });
  if (url) request.result = fetchPage({ url }).then(() => {});
}

async function installStyles({ next }: { next: Document }) {
  next
    .querySelectorAll("style[data-docs-style]")
    .forEach((style) => document.head.append(style.cloneNode(true)));

  const pending = [...next.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].map(
    (source) => {
      if (
        [...document.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].some(
          (link) => link.href === source.href,
        )
      )
        return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = source.href;
        link.dataset.docsStyle = "";
        link.onload = () => resolve();
        link.onerror = () => {
          link.remove();
          reject(new Error("Styles unavailable"));
        };
        document.head.append(link);
      });
    },
  );
  await Promise.all(pending);
}

function updateHead({ next }: { next: Document }) {
  document.title = next.title;
  const selector =
    'meta[name="description"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"], link[rel="alternate"], link[rel="describedby"], script[data-docs-metadata]';
  document.head.querySelectorAll(selector).forEach((node) => node.remove());
  next.head
    .querySelectorAll(selector)
    .forEach((node) => document.head.append(node.cloneNode(true)));
  const hrefs = new Set(
    [...next.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].map((link) => link.href),
  );
  document.querySelectorAll<HTMLLinkElement>("link[data-docs-style]").forEach((link) => {
    if (!hrefs.has(link.href)) link.remove();
  });
}

function finishNavigation({ url, restored }: { url: URL; restored: boolean }) {
  document.dispatchEvent(new Event("docs:navigated"));
  const content = document.getElementById("content");
  const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
  content?.focus({ preventScroll: true });
  if (target) target.scrollIntoView();
  else window.scrollTo({ top: restored ? (positions.get(url.href) ?? 0) : 0, behavior: "instant" });
  const announcement = document.getElementById("docs-navigation-status");
  if (announcement) announcement.textContent = document.title;
}

async function navigate({ url, restored = false }: { url: URL; restored?: boolean }) {
  const sequence = ++navigating;
  positions.set(current, scrollY);
  try {
    const html = await fetchPage({ url });
    const next = new DOMParser().parseFromString(html, "text/html");
    const build = (root: Document) =>
      root.querySelector<HTMLMetaElement>('meta[name="docs-build"]')?.content;
    const layout = next.querySelector(".docs-layout");
    if (!layout || build(next) !== build(document)) throw new Error("A fresh document is required");
    await installStyles({ next });
    if (sequence !== navigating) return;
    document.dispatchEvent(new Event("docs:leaving"));
    document
      .querySelectorAll<HTMLDialogElement>("dialog[open]")
      .forEach((dialog) => dialog.close());
    document.querySelector(".docs-layout")?.replaceWith(layout);
    const ground = document.querySelector<HTMLElement>(".docs-ground");
    if (ground) ground.dataset.home = String(layout.getAttribute("data-kind") === "home");
    document
      .querySelector("header")
      ?.setAttribute("data-kind", layout.getAttribute("data-kind") ?? "guide");
    document
      .getElementById("docs-page-data")
      ?.replaceWith(next.getElementById("docs-page-data") ?? document.createElement("script"));
    document
      .getElementById("docs-mobile-nav")
      ?.replaceWith(next.getElementById("docs-mobile-nav") ?? document.createElement("span"));
    updateHead({ next });
    if (!restored) history.pushState(null, "", url);
    current = url.href;
    finishNavigation({ url, restored });
  } catch {
    if (sequence === navigating) location.assign(url);
  }
}

export function startNavigation() {
  history.scrollRestoration = "manual";
  const status = document.createElement("output");
  status.id = "docs-navigation-status";
  status.className = "docs-sr-only";
  status.setAttribute("aria-live", "polite");
  document.body.append(status);
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || modifiedClick({ event })) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    const url = pageUrl({ anchor });
    if (!url) return;
    event.preventDefault();
    void navigate({ url });
  });
  document.addEventListener("docs:prefetch", (event) => prefetch({ event }));
  window.addEventListener("popstate", () => {
    void navigate({ url: new URL(location.href), restored: true });
  });
}

function modifiedClick({ event }: { event: MouseEvent }) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
