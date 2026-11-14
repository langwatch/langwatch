import { docsBasePath } from "../config.ts";

/** A fetched page: its HTML and the address it ended at after any host redirect. */
type Fetched = { html: string; url: string };

const pages = new Map<string, { at: number; html: Promise<Fetched> }>();
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
    async (response): Promise<Fetched> => {
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
        throw new Error("Page unavailable");
      return { html: await response.text(), url: response.url || key };
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

/** Whether a page may be fetched ahead of a click: never offline or for a reader saving data. */
function mayFetchAhead() {
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  return navigator.onLine && !saveData;
}

/* A hover or visible-link prefetch from the reading island passes the same policy as a press. */
function prefetch({ event }: { event: Event }) {
  const request = (event as CustomEvent<PrefetchRequest>).detail;
  const url = pageUrl({ anchor: request.anchor });
  if (url && mayFetchAhead()) request.result = fetchPage({ url }).then(() => {});
}

/* The shared sheet of a page that has not finished loading names its address in `data-href`. */
function sheetHref(link: HTMLLinkElement) {
  const pending = link.dataset.href;
  return pending ? new URL(pending, document.baseURI).href : link.href;
}

/** Asks for every shared sheet still named only by `data-href`. The page paints from its inlined
    rules, so the bootstrap calls this once the window has loaded (`afterLoad`). */
export function loadSharedSheets() {
  document.querySelectorAll<HTMLLinkElement>("link[data-docs-style][data-href]").forEach((link) => {
    link.href = sheetHref(link);
    link.removeAttribute("data-href");
  });
}

async function installStyles({ next }: { next: Document }) {
  next
    .querySelectorAll("style[data-docs-style]")
    .forEach((style) => document.head.append(style.cloneNode(true)));

  const pending = [...next.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].map(
    (source) => {
      const present = [...document.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].find(
        (link) => sheetHref(link) === sheetHref(source),
      );
      /* The shared sheet loads after the page. A click before that asks for it now rather than
         waiting for the rest of the page; either way, wait while it is on its way. */
      if (present?.dataset.href !== undefined) {
        present.href = sheetHref(present);
        present.removeAttribute("data-href");
      }
      if (present)
        return present.sheet
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              present.addEventListener("load", () => resolve(), { once: true });
              present.addEventListener("error", () => resolve(), { once: true });
            });
      return new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheetHref(source);
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
    [...next.querySelectorAll<HTMLLinkElement>("link[data-docs-style]")].map(sheetHref),
  );
  document.querySelectorAll<HTMLLinkElement>("link[data-docs-style]").forEach((link) => {
    if (!hrefs.has(sheetHref(link))) link.remove();
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
  /* The page answers at once: it dims while the next one is fetched (docs.css). */
  const leaving = document.querySelector(".docs-layout");
  leaving?.setAttribute("data-docs-loading", "");
  try {
    const fetched = await fetchPage({ url });
    const next = new DOMParser().parseFromString(fetched.html, "text/html");
    const address = new URL(fetched.url);
    address.hash = url.hash;
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
    /* From the first swap on, a page swapped in rises in; a full load never does. */
    document.documentElement.setAttribute("data-docs-navigated", "");
    document.querySelector(".docs-layout")?.replaceWith(layout);
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
    if (!restored) history.pushState(null, "", address);
    else if (address.href !== location.href) history.replaceState(null, "", address);
    current = address.href;
    finishNavigation({ url: address, restored });
  } catch {
    if (sequence !== navigating) return;
    /* Undimmed first, or the back button could restore the dimmed page from the cache. */
    leaving?.removeAttribute("data-docs-loading");
    location.assign(url);
  }
}

/** The page a plain main-button press or click on an internal link leads to, if any. */
function followedPage({ event }: { event: MouseEvent }) {
  if (event.button !== 0 || modifiedClick({ event })) return null;
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  return anchor ? pageUrl({ anchor }) : null;
}

export function startNavigation() {
  history.scrollRestoration = "manual";
  const status = document.createElement("output");
  status.id = "docs-navigation-status";
  status.className = "docs-sr-only";
  status.setAttribute("aria-live", "polite");
  document.body.append(status);
  document.addEventListener("click", (event) => {
    const url = event.defaultPrevented ? null : followedPage({ event });
    if (!url) return;
    event.preventDefault();
    void navigate({ url });
  });
  /* A press comes some 100ms before its click, more on touch, where no hover prefetches: the
     fetch starts there and the click reuses it from the page cache. */
  document.addEventListener(
    "pointerdown",
    (event) => {
      const url = followedPage({ event });
      if (url && mayFetchAhead()) fetchPage({ url }).catch(() => {});
    },
    { passive: true },
  );
  document.addEventListener("docs:prefetch", (event) => prefetch({ event }));
  window.addEventListener("popstate", () => {
    void navigate({ url: new URL(location.href), restored: true });
  });
}

function modifiedClick({ event }: { event: MouseEvent }) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
