import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import { searchEntrySchema, searchIndex } from "./search-model.ts";
import type { SearchEntry } from "./search-model.ts";

function SearchContent() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[]>([]);
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    void fetch("/search-index.json", { signal: abort.signal, credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Search unavailable");
        setIndex(z.array(searchEntrySchema).parse(await response.json()));
        setState("ready");
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("failed");
      });
    input.current?.focus();
    return () => abort.abort();
  }, [attempt]);
  const results = searchIndex({ index, query });
  return (
    <>
      <div className="docs-search-input">
        <span id="docs-search-help" className="docs-sr-only">
          Use the down arrow to move to the results, or Tab to browse links.
        </span>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="docs-search-help"
          aria-label="Search the LangWatch docs"
          placeholder="Search the LangWatch docs"
        />
        <button type="button" onClick={() => dialog.close()}>
          Close
        </button>
      </div>
      <div className="docs-search-body">
        <output className="docs-sr-only" aria-live="polite">
          {results.length} results
        </output>
        {state === "loading" ? <p>Loading search...</p> : null}
        {state === "failed" ? (
          <p>
            Search could not load.{" "}
            <button type="button" onClick={() => setAttempt(attempt + 1)}>
              Retry
            </button>
          </p>
        ) : null}
        {state === "ready" && !query.trim() ? (
          <p>Search by topic, integration or endpoint</p>
        ) : null}
        {state === "ready" && query.trim() && !results.length ? (
          <p>No results for “{query}”. Try a broader term.</p>
        ) : null}
        <ul id="docs-search-results" aria-label={`${results.length} results`}>
          {results.map(({ entry, heading }, position) => (
            <li key={`${entry.slug}#${heading?.id ?? ""}`}>
              <a
                id={`docs-search-result-${position}`}
                href={`/${entry.slug}${heading ? `#${heading.id}` : ""}`}
              >
                <strong>{entry.title}</strong>
                {heading ? <span>{heading.text}</span> : null}
                <small>{entry.trail || entry.section}</small>
                <small className="docs-search-description">{entry.description}</small>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

const dialog = document.createElement("dialog");
dialog.className = "docs-island-dialog docs-search-dialog";
dialog.setAttribute("aria-label", "Search the LangWatch docs");
document.body.append(dialog);
const root = createRoot(dialog);
let opener: Element | null = null;
function openSearch() {
  if (dialog.open) return;
  opener = document.activeElement;
  root.render(<SearchContent key={Date.now()} />);
  dialog.showModal();
}
dialog.addEventListener("close", () => {
  if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
});
dialog.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const results = [...dialog.querySelectorAll<HTMLAnchorElement>("#docs-search-results a")];
  if (!results.length) return;
  const index = results.findIndex((element) => element === document.activeElement);
  event.preventDefault();
  results[
    Math.max(0, Math.min(results.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
  ]?.focus();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-docs-search]")) openSearch();
});
document.addEventListener("docs:search", openSearch);
document.addEventListener("docs:leaving", () => {
  dialog.close();
  root.render(null);
});
openSearch();
