import {
  CommandBarFooter,
  CommandBarGroup,
  CommandBarInput,
  CommandBarItem,
} from "@langwatch/design-system/app-shell";
import { Box, Button, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight, FileText, Hash, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { pagePath } from "../../../lib/site-path.ts";
import { searchIndex, type SearchIndex } from "../model/search-engine.ts";
import { QUICK_ACTIONS, runQuickAction } from "./search-actions.ts";
import { currentBuild, loadSearchIndex } from "./search-index-store.ts";

function useSearchIndex() {
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState("loading");
    loadSearchIndex({ build: currentBuild() })
      .then((loadedIndex) => {
        if (!current) return;
        setIndex(loadedIndex);
        setState("ready");
      })
      .catch(() => {
        if (current) setState("failed");
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  return { index, state, retry: () => setAttempt(attempt + 1) };
}
function commandRows({ index, query }: { index: SearchIndex | null; query: string }) {
  const results = index ? searchIndex({ index, query }) : [];
  const pages = results.map(({ entry, heading }) => ({
    id: `${entry.slug}#${heading?.id ?? ""}`,
    title: entry.title,
    description: heading ? `↳ ${heading.text}` : entry.description,
    href: `${pagePath({ slug: entry.slug })}${heading ? `#${heading.id}` : ""}`,
    group: entry.section,
    method: entry.method,
    heading: Boolean(heading),
  }));
  const actions = QUICK_ACTIONS.filter(
    (action) =>
      !query || `${action.title} ${action.description}`.toLowerCase().includes(query.toLowerCase()),
  ).map((action) => ({ ...action, group: "Quick actions", method: "", heading: false }));
  return [...pages, ...actions].toSorted((left, right) => {
    const leftGroup = left.group === "Quick actions" ? "" : left.group;
    const rightGroup = right.group === "Quick actions" ? "" : right.group;
    return leftGroup.localeCompare(rightGroup);
  });
}
export function SearchContent({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { index, state, retry } = useSearchIndex();
  const rows = commandRows({ index, query });
  useEffect(() => {
    input.current?.setAttribute("aria-label", "Search the LangWatch docs");
    input.current?.setAttribute("type", "search");
    input.current?.setAttribute("aria-controls", "docs-search-results");

    input.current?.setAttribute("aria-autocomplete", "list");
  });
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    input.current?.setAttribute(
      "aria-activedescendant",
      rows.length ? `docs-command-${selected}` : "",
    );
    document.getElementById(`docs-command-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);
  const run = async (id: string) => {
    try {
      await runQuickAction({ id });
      setNotice(id === "copy" ? "Page copied" : "Theme changed");
    } catch {
      setNotice("Could not copy. Open the page menu to view Markdown.");
    }
  };
  return (
    <Box
      className="docs-command-bar"
      onKeyDown={(event) => handleSearchKey({ event, rows, selected, setSelected, setNotice })}
    >
      <CommandBarInput
        inputRef={input}
        query={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={() => {}}
        isSearching={state === "loading"}
        placeholder="Search the LangWatch docs"
      />
      <Box className="docs-command-results" borderTopWidth="1px" borderColor="border">
        {state === "failed" ? (
          <Box padding="4">
            <Text>Search could not load.</Text>
            <Button onClick={retry} size="sm">
              Retry
            </Button>
          </Box>
        ) : null}
        {state === "ready" && query && !rows.length ? (
          <Text padding="4">No results for “{query}”. Try a broader term.</Text>
        ) : null}
        <SearchRows
          rows={rows}
          selected={selected}
          setSelected={setSelected}
          close={close}
          run={run}
        />
      </Box>
      <Text
        as="output"
        aria-live="polite"
        paddingX="5"
        paddingY="2"
        fontSize="12px"
        color="fg.muted"
      >
        {notice || (query ? `${rows.length} results` : "Search by topic, integration or endpoint")}
      </Text>
      <CommandBarFooter isMac={/Mac|iPhone|iPad/.test(navigator.platform)} />
      <Button className="docs-command-close" size="xs" variant="ghost" onClick={close}>
        Close
      </Button>
    </Box>
  );
}

function rowIcon({ row }: { row: ReturnType<typeof commandRows>[number] }) {
  if (row.heading) return Hash;
  return row.group === "Quick actions" ? ArrowUpRight : FileText;
}
function SearchRows({
  rows,
  selected,
  setSelected,
  close,
  run,
}: {
  rows: ReturnType<typeof commandRows>;
  selected: number;
  setSelected: (value: number) => void;
  close: () => void;
  run: (id: string) => Promise<void>;
}) {
  return (
    <Box id="docs-search-results" as="ul" aria-label="Documentation and actions">
      {[...new Set(rows.map((row) => row.group))].map((group) => (
        <CommandBarGroup key={group} label={group}>
          {rows.map((row, position) =>
            row.group !== group ? null : (
              <Box
                key={row.id}
                id={`docs-command-${position}`}
                as="li"
                aria-current={selected === position ? "true" : void 0}
                data-method={row.method}
                className={row.method ? "docs-command-operation" : ""}
              >
                <Box asChild display="block" width="100%" textAlign="left" textDecoration="none">
                  {row.href ? (
                    <a href={row.href} tabIndex={-1} onClick={close}>
                      <CommandBarItem
                        icon={rowIcon({ row })}
                        iconColor="fg.muted"
                        label={row.title}
                        description={row.description}
                        meta={row.method}
                        index={position}
                        isSelected={position === selected}
                        onSelect={() => {}}
                        onMouseEnter={() => setSelected(position)}
                      />
                    </a>
                  ) : (
                    <button type="button" tabIndex={-1} onClick={() => void run(row.id)}>
                      <CommandBarItem
                        icon={Zap}
                        iconColor="accent.fg"
                        label={row.title}
                        description={row.description}
                        index={position}
                        isSelected={position === selected}
                        onSelect={() => {}}
                        onMouseEnter={() => setSelected(position)}
                      />
                    </button>
                  )}
                </Box>
              </Box>
            ),
          )}
        </CommandBarGroup>
      ))}
    </Box>
  );
}

function handleSearchKey({
  event,
  rows,
  selected,
  setSelected,
  setNotice,
}: {
  event: KeyboardEvent;
  rows: ReturnType<typeof commandRows>;
  selected: number;
  setSelected: (value: number) => void;
  setNotice: (value: string) => void;
}) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setSelected(
      (selected + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(rows.length, 1),
    );
  }
  const row = rows[selected];
  if (!row) return;
  if (event.key === "Enter") {
    event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && row.href)
      window.open(row.href, "_blank", "noopener,noreferrer");
    else document.querySelector<HTMLElement>(`#docs-command-${selected} :is(a,button)`)?.click();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l" && row.href) {
    event.preventDefault();
    void navigator.clipboard.writeText(new URL(row.href, location.href).href).then(
      () => setNotice("Link copied"),
      () => setNotice("Could not copy link"),
    );
  }
}
