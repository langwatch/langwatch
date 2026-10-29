import { DOCS_URL, sitePath, stripBasePath } from "../../../lib/site-path.ts";
import { notFoundContext, searchWords, type NotFoundIndex } from "../model/not-found.ts";
import { matchRedirect, type RedirectRules } from "../model/redirect-match.ts";
import { picks, sceneContent } from "./not-found-scenes.ts";

/* Loaded on the 404 page only. A static host serves exact redirects as pages, but a pattern
   such as "/guardrails/:path*" needs this, so redirects come first. A miss then acts out the
   scene for the address's section with its closest pages (specs/rendering.feature). */
async function redirectTarget({ path }: { path: string }) {
  const response = await fetch(sitePath({ path: "/redirects.json" }), { credentials: "omit" });
  if (!response.ok) return null;
  const destination = matchRedirect({ path, redirects: (await response.json()) as RedirectRules });
  if (!destination) return null;
  const target = new URL(
    /^https?:\/\//.test(destination) ? destination : sitePath({ path: destination }),
    location.origin,
  );
  for (const [key, value] of new URLSearchParams(location.search))
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  if (!target.hash) target.hash = location.hash;
  return target;
}

function shownPath() {
  try {
    return decodeURI(location.pathname);
  } catch {
    return location.pathname;
  }
}

function fillRail({
  root,
  pages,
  shown,
}: {
  root: HTMLElement;
  pages: Element | null;
  shown: string;
}) {
  const rail = document.querySelector<HTMLElement>("[data-nf-matches]");
  const list = rail?.querySelector("[data-nf-rail-matches]");
  if (rail && list && pages) {
    list.replaceChildren(
      ...[...pages.querySelectorAll<HTMLAnchorElement>("a")].map((pick) => {
        const link = document.createElement("a");
        link.href = pick.href;
        link.textContent = pick.querySelector(".docs-nf-title")?.textContent ?? pick.href;
        const item = document.createElement("li");
        item.append(link);
        return item;
      }),
    );
    rail.hidden = false;
  }
  const report = document.querySelector<HTMLAnchorElement>("[data-nf-report]");
  if (report) {
    const url = new URL(report.href);
    url.searchParams.set("title", `Broken docs link: ${shown}`);
    const from = document.referrer ? `Linked from ${document.referrer}` : "Opened directly";
    url.searchParams.set("body", `${location.href} returns a 404.\n\n${from}.`);
    report.href = url.href;
  }
  root.dataset.ready = "";
}

function showScene({ root, path }: { root: HTMLElement; path: string }) {
  const index = JSON.parse(root.dataset.docsNotFoundIndex ?? "") as NotFoundIndex;
  const { section, pages, scene } = notFoundContext({ path, index });
  const shown = shownPath();
  const query = searchWords({ path });
  root.dataset.scene = scene;
  const sectionLabel = root.querySelector("[data-nf-section]");
  if (sectionLabel && section) sectionLabel.textContent = section;
  const address = root.querySelector("[data-nf-address]");
  if (address) address.textContent = shown;
  for (const search of document.querySelectorAll<HTMLElement>("[data-nf-search]"))
    search.dataset.docsSearchQuery = query;
  const stage = root.querySelector<HTMLElement>("[data-nf-stage]");
  const content = sceneContent({
    scene,
    input: { shown, host: new URL(DOCS_URL).host, pages, query },
  });
  if (stage && content) stage.replaceChildren(content);
  if (stage && !content && pages.length)
    stage.querySelector(".docs-nf-picks")?.replaceWith(picks({ pages, label: "Closest pages" }));
  fillRail({ root, pages: pages.length ? root.querySelector(".docs-nf-picks") : null, shown });
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** 1 to 3 open the closest pages, / opens search with the address's words, ? the shortcuts. */
function onKey(event: KeyboardEvent) {
  const root = document.querySelector<HTMLElement>("[data-docs-not-found]");
  if (!root || event.metaKey || event.ctrlKey || event.altKey) return;
  const input = root.querySelector<HTMLInputElement>("input[data-docs-search]");
  if (event.target === input && event.key.length === 1) {
    event.preventDefault();
    input?.click();
    return;
  }
  if (typing(event.target)) return;
  const pick = root.querySelector<HTMLAnchorElement>(`[data-nf-pick="${event.key}"]`);
  if (pick) pick.click();
  else if (event.key === "/") {
    event.preventDefault();
    (input ?? document.querySelector<HTMLElement>("[data-nf-search]"))?.click();
  } else if (event.key === "?") {
    const shortcuts = root.querySelector<HTMLElement>("[data-nf-shortcuts]");
    if (shortcuts) shortcuts.hidden = !shortcuts.hidden;
  } else return;
  event.preventDefault();
}

async function recoverFromNotFound() {
  const path = stripBasePath({ pathname: location.pathname });
  const root = document.querySelector<HTMLElement>("[data-docs-not-found]");
  if (path === null || !root) return;
  const target = await redirectTarget({ path }).catch(() => null);
  if (target) return location.replace(target.href);
  showScene({ root, path });
  document.addEventListener("keydown", onKey);
  document.addEventListener("docs:leaving", () => document.removeEventListener("keydown", onKey), {
    once: true,
  });
}

void recoverFromNotFound().catch(() => {
  document.querySelector<HTMLElement>("[data-docs-not-found]")?.setAttribute("data-ready", "");
});
