import type { SearchIndex } from "../model/search-engine.ts";
import { searchRows, type SearchRow } from "../model/search-rows.ts";
import { runQuickAction } from "./search-actions.ts";
import { fromTemplate, groupElements } from "./search-dom.ts";
import { currentBuild, loadSearchIndex } from "./search-index-store.ts";

/* The index starts downloading as soon as the island runs, before the dialog first opens. */
loadSearchIndex({ build: currentBuild() }).catch(() => {});

type Bar = {
  dialog: HTMLDialogElement;
  input: HTMLInputElement;
  results: HTMLElement;
  part: (name: string) => HTMLElement;
};

let bar: Bar | undefined;
let rows: SearchRow[] = [];
let selected = 0;
let index: SearchIndex | null = null;
let state: "loading" | "ready" | "failed" = "loading";
let notice = "";
let opener: HTMLElement | null = null;

/** The prerendered command bar, moved into the page once and reused for every open. */
function commandBar(): Bar {
  if (bar) return bar;
  const dialog = fromTemplate({ id: "docs-search-dialog" }) as HTMLDialogElement;
  const input = dialog.querySelector("input");
  const results = dialog.querySelector<HTMLElement>("#docs-search-results");
  if (!input || !results) throw new Error("The search template has no field or result list");
  input.type = "search";
  input.setAttribute("aria-label", "Search the LangWatch docs");
  input.setAttribute("aria-controls", "docs-search-results");
  input.setAttribute("aria-autocomplete", "list");
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    for (const hint of dialog.querySelectorAll(".docs-command-bar > div:last-of-type p"))
      hint.textContent = hint.textContent?.replace("Ctrl", "⌘") ?? "";
  }
  const part = (name: string) => {
    const element = dialog.querySelector<HTMLElement>(`[data-search-part="${name}"]`);
    if (!element) throw new Error(`The search template has no ${name} part`);
    return element;
  };
  input.addEventListener("input", () => {
    selected = 0;
    notice = "";
    render();
  });
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("close", onClose);
  /* A click on the backdrop lands on the dialog itself, outside its box. */
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  results.addEventListener("mousemove", (event) => {
    const row = event.target instanceof Element ? event.target.closest("[data-index]") : null;
    const position = Number(row?.getAttribute("data-index") ?? Number.NaN);
    if (Number.isInteger(position) && position !== selected) select({ position });
  });
  results.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("a, button") : null;
    if (target instanceof HTMLAnchorElement) dialog.close();
    if (target instanceof HTMLButtonElement && target.dataset.searchAction)
      void run({ id: target.dataset.searchAction });
  });
  part("retry").addEventListener("click", () => void load());
  part("close").addEventListener("click", () => dialog.close());
  document.body.append(dialog);
  bar = { dialog, input, results, part };
  return bar;
}

function select({ position }: { position: number }) {
  if (!bar) return;
  selected = position;
  for (const row of bar.results.querySelectorAll("[data-index]")) {
    const current = row.getAttribute("data-index") === String(position);
    row.toggleAttribute("data-selected", current);
    row.closest("li")?.toggleAttribute("aria-current", current);
  }
  bar.input.setAttribute("aria-activedescendant", rows.length ? `docs-command-${position}` : "");
  document.getElementById(`docs-command-${position}`)?.scrollIntoView({ block: "nearest" });
}

function render() {
  if (!bar) return;
  try {
    bar.part("broken").hidden = true;
    const query = bar.input.value;
    rows = searchRows({ index, query });
    bar.results.replaceChildren(...groupElements({ rows }));
    bar.dialog.querySelector<HTMLElement>(".chakra-spinner")?.toggleAttribute(
      "hidden",
      state !== "loading",
    );
    bar.part("failed").hidden = state !== "failed";
    const empty = bar.part("empty");
    empty.hidden = !(state === "ready" && query && !rows.length);
    empty.textContent = `No results for “${query}”. Try a broader term.`;
    bar.part("status").textContent =
      notice || (query ? `${rows.length} results` : "Search by topic, integration or endpoint");
    select({ position: Math.min(selected, Math.max(rows.length - 1, 0)) });
  } catch (error) {
    bar.results.replaceChildren();
    bar.part("broken").hidden = false;
    console.error(error);
  }
}

async function load() {
  state = "loading";
  render();
  try {
    index = await loadSearchIndex({ build: currentBuild() });
    state = "ready";
  } catch {
    state = "failed";
  }
  render();
}

async function run({ id }: { id: string }) {
  try {
    await runQuickAction({ id });
    notice = id === "copy" ? "Page copied" : "Theme changed";
  } catch {
    notice = "Could not copy. Open the page menu to view Markdown.";
  }
  render();
}

function onKey(event: KeyboardEvent) {
  /* A search field spends Escape on clearing itself; here it always closes the bar. */
  if (event.key === "Escape") {
    event.preventDefault();
    bar?.dialog.close();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
    select({ position: (selected + step) % Math.max(rows.length, 1) });
  }
  const row = rows[selected];
  if (!row) return;
  const modified = event.metaKey || event.ctrlKey;
  if (event.key === "Enter") {
    event.preventDefault();
    if (modified && row.href) window.open(row.href, "_blank", "noopener,noreferrer");
    else document.querySelector<HTMLElement>(`#docs-command-${selected} :is(a,button)`)?.click();
  }
  if (modified && event.key.toLowerCase() === "l" && row.href) {
    event.preventDefault();
    void navigator.clipboard.writeText(new URL(row.href, location.href).href).then(
      () => (notice = "Link copied"),
      () => (notice = "Could not copy link"),
    ).then(render);
  }
}

function onClose() {
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

/** Opens the bar, prefilled with `query` (a trigger's `data-docs-search-query`) when given. */
function openSearch({ query = "" }: { query?: string } = {}) {
  const { dialog, input } = commandBar();
  if (dialog.open) return;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  input.value = query;
  selected = 0;
  notice = "";
  dialog.showModal();
  input.focus();
  if (state === "ready") render();
  else void load();
}

document.addEventListener("click", (event) => {
  const trigger =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-docs-search]")
      : null;
  if (trigger) openSearch({ query: trigger.dataset.docsSearchQuery });
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && /^k$/i.test(event.key)) {
    event.preventDefault();
    openSearch();
  }
});
/* A shortcut pressed while this island was still loading opens it now. */
if ((window as { docsSearchKey?: number }).docsSearchKey) openSearch();
document.addEventListener("docs:leaving", () => bar?.dialog.close());
