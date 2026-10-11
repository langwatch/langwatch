import { Dialog } from "@langwatch/design-system/dialog";
import {
  Box,
  Button,
  Flex,
  chakra,
  Link,
  Spinner,
  Text,
} from "@langwatch/design-system/primitives";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { searchEntrySchema, searchIndex } from "../islands/search-model.ts";
import type { SearchEntry } from "../islands/search-model.ts";
export { searchIndex };
type Result = { entry: SearchEntry; heading?: { id: string; text: string }; score: number };

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(pattern).map((part, position) =>
        position % 2 === 1 ? (
          <Box as="strong" key={position} color="fg" fontWeight="700">
            {part}
          </Box>
        ) : (
          part
        ),
      )}
    </>
  );
}

type Load = { state: "idle" | "loading" | "failed" } | { state: "ready"; index: SearchEntry[] };

function hrefOf({ result }: { result: Result }) {
  return `/${result.entry.slug}${result.heading ? `#${result.heading.id}` : ""}`;
}

function SearchResults({
  results,
  terms,
  selected,
  setSelected,
}: {
  results: Result[];
  terms: string[];
  selected: number;
  setSelected: (index: number) => void;
}) {
  return (
    <Box
      as="ul"
      id="docs-search-results"
      margin="0"
      padding="0"
      aria-label={`${results.length} results`}
    >
      {results.map((result, position) => (
        <Box as="li" key={`${result.entry.slug}-${result.heading?.id ?? ""}`} listStyleType="none">
          <Link
            id={`docs-search-result-${position}`}
            onFocus={() => setSelected(position)}
            href={hrefOf({ result })}
            display="block"
            minHeight="64px"
            padding="3"
            borderRadius="lg"
            bg={position === selected ? "accent.subtle" : void 0}
            borderInlineStartWidth="2px"
            borderColor={position === selected ? "accent.fg" : "transparent"}
            textDecoration="none"
            _hover={{ bg: "nav.bgHover", textDecoration: "none" }}
            onMouseMove={() => setSelected(position)}
          >
            <Text
              as="span"
              display="block"
              fontSize="14px"
              lineHeight="20px"
              fontWeight="600"
              color="fg"
            >
              <Highlighted text={result.entry.title} terms={terms} />
            </Text>
            {result.heading ? (
              <Text as="span" display="block" fontSize="13px" lineHeight="20px" color="fg.muted">
                {result.heading.text}
              </Text>
            ) : null}
            <Text as="span" display="block" fontSize="12px" lineHeight="20px" color="fg.muted">
              {result.entry.trail || result.entry.section}
            </Text>
            {result.entry.description ? (
              <Text
                as="span"
                display="-webkit-box"
                fontSize="12px"
                lineHeight="20px"
                color="fg.muted"
                css={{
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {result.entry.description}
              </Text>
            ) : null}
          </Link>
        </Box>
      ))}
    </Box>
  );
}

function SearchContent({
  load,
  query,
  results,
  terms,
  selected,
  setSelected,
  start,
}: {
  load: Load;
  query: string;
  results: Result[];
  terms: string[];
  selected: number;
  setSelected: (index: number) => void;
  start: () => void;
}) {
  if (load.state === "loading" || load.state === "idle")
    return (
      <Flex alignItems="center" gap="2" padding="4" color="fg.muted">
        <Spinner size="sm" /> Loading search...
      </Flex>
    );
  if (load.state === "failed")
    return (
      <Flex direction="column" gap="2" padding="4">
        <Text margin="0">Search could not load.</Text>
        <Flex gap="3">
          <Button type="button" size="sm" variant="outline" colorPalette="gray" onClick={start}>
            Retry
          </Button>
          <Link href="/introduction" color="blue.fg" alignSelf="center">
            Browse sections
          </Link>
        </Flex>
      </Flex>
    );
  if (!query.trim())
    return (
      <Box padding="4">
        <Text margin="0" color="fg.muted" fontSize="14px">
          Search by topic, integration or endpoint
        </Text>
        <Flex direction="column" marginTop="3">
          {[
            ["Introduction", "/introduction"],
            ["Quick Start", "/integration/quick-start"],
            ["API Reference", "/api-reference/introduction"],
          ].map(([label, href]) => (
            <Link key={href} href={href} paddingY="2" fontSize="14px" color="blue.fg">
              {label}
            </Link>
          ))}
        </Flex>
      </Box>
    );
  if (results.length === 0)
    return (
      <Text margin="0" padding="4" color="fg.muted">
        No results for “{query}”. Try a broader term.
      </Text>
    );
  return (
    <SearchResults results={results} terms={terms} selected={selected} setSelected={setSelected} />
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const start = () => {
    setLoad({ state: "loading" });
    fetch("/search-index.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: unknown) =>
        setLoad({ state: "ready", index: z.array(searchEntrySchema).parse(data) }),
      )
      .catch(() => setLoad({ state: "failed" }));
  };
  useEffect(() => {
    if (open && load.state === "idle") start();
  }, [open, load.state]);
  const results = useMemo(
    () => (load.state === "ready" ? searchIndex({ index: load.index, query }) : []),
    [load, query],
  );
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    document.getElementById(`docs-search-result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (results.length === 0) return;
    event.preventDefault();
    const fromInput = event.target === input.current;
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = fromInput ? 0 : Math.max(0, Math.min(selected + step, results.length - 1));
    setSelected(next);
    document.getElementById(`docs-search-result-${next}`)?.focus();
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => (next ? undefined : onClose())}
      placement="top"
      initialFocusEl={() => input.current}
      lazyMount
      unmountOnExit
    >
      <Dialog.Content
        maxWidth="640px"
        width="calc(100% - 2rem)"
        marginTop={{ base: "0", md: "24" }}
        maxHeight={{ base: "100dvh", md: "min(640px, calc(100vh - 8rem))" }}
        display="flex"
        flexDirection="column"
        bg="bg.overlay"
        onKeyDown={onKeyDown}
      >
        <Dialog.Title className="docs-sr-only">Search the LangWatch docs</Dialog.Title>
        <Flex
          alignItems="center"
          gap="3"
          paddingX="4"
          borderBottomWidth="1px"
          borderColor="border.muted"
          minHeight="56px"
        >
          <Search size={18} aria-hidden="true" />
          <span id="docs-search-help" className="docs-sr-only">
            Use the down arrow to move to the results, or Tab to browse links.
          </span>
          <chakra.input
            ref={input}
            type="search"
            aria-describedby="docs-search-help"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the LangWatch docs"
            aria-label="Search the LangWatch docs"
            flex="1"
            minWidth="0"
            bg="transparent"
            border="none"
            fontSize="16px"
            height="56px"
            outline="none"
          />
          <Button
            type="button"
            size="xs"
            variant="ghost"
            colorPalette="gray"
            onClick={onClose}
            display={{ md: "none" }}
          >
            Close
          </Button>
        </Flex>
        <Box overflowY="auto" padding="2" flex="1">
          <output className="docs-sr-only" aria-live="polite">
            {results.length} results
          </output>
          <SearchContent
            load={load}
            query={query}
            results={results}
            terms={terms}
            selected={selected}
            setSelected={setSelected}
            start={start}
          />
        </Box>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function useSearchShortcut({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
