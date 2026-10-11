import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, Flex, Input, Link, Spinner, Text } from "@langwatch/design-system/primitives";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchEntry = {
  slug: string;
  title: string;
  section: string;
  description: string;
  headings: { id: string; text: string }[];
};

type Result = { entry: SearchEntry; heading?: { id: string; text: string }; score: number };

const MAX_RESULTS = 20;

function scoreEntry({ entry, terms }: { entry: SearchEntry; terms: string[] }): Result | null {
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  let score = 0;
  let heading: Result["heading"];
  for (const term of terms) {
    let best = 0;
    if (title === term) best = 100;
    else if (title.startsWith(term)) best = 60;
    else if (title.includes(term)) best = 40;
    const hit = entry.headings.find((candidate) => candidate.text.toLowerCase().includes(term));
    if (hit && best < 25) {
      best = 25;
      heading = heading ?? hit;
    }
    if (description.includes(term) && best < 10) best = 10;
    if (entry.slug.includes(term) && best < 8) best = 8;
    if (best === 0) return null;
    score += best;
  }
  return { entry, heading, score };
}

export function searchIndex({ index, query }: { index: SearchEntry[]; query: string }): Result[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return index
    .map((entry) => scoreEntry({ entry, terms }))
    .filter((result): result is Result => result !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
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

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const start = () => {
    setLoad({ state: "loading" });
    fetch("/search-index.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((index: SearchEntry[]) => setLoad({ state: "ready", index }))
      .catch(() => setLoad({ state: "failed" }));
  };
  useEffect(() => {
    if (open && load.state === "idle") start();
  }, [open, load.state]);
  const results = useMemo(() => (load.state === "ready" ? searchIndex({ index: load.index, query }) : []), [load, query]);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  useEffect(() => setSelected(0), [query]);
  const hrefOf = ({ result }: { result: Result }) => `/${result.entry.slug}${result.heading ? `#${result.heading.id}` : ""}`;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[selected]) {
      window.location.href = hrefOf({ result: results[selected] });
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => (next ? undefined : onClose())} placement="top" initialFocusEl={() => input.current} lazyMount unmountOnExit>
      <Dialog.Content maxWidth="640px" width="calc(100% - 2rem)" marginTop={{ base: "0", md: "24" }} maxHeight={{ base: "100dvh", md: "min(640px, calc(100vh - 8rem))" }} display="flex" flexDirection="column" bg="bg.overlay">
        <Dialog.Title className="docs-sr-only">Search the LangWatch docs</Dialog.Title>
        <Flex alignItems="center" gap="3" paddingX="4" borderBottomWidth="1px" borderColor="border.muted" minHeight="56px">
          <Search size={18} aria-hidden="true" />
          <Input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search the LangWatch docs"
            aria-label="Search the LangWatch docs"
            variant="flushed"
            border="none"
            fontSize="16px"
            height="56px"
            outline="none"
          />
          <Button type="button" size="xs" variant="ghost" colorPalette="gray" onClick={onClose} display={{ md: "none" }}>
            Close
          </Button>
        </Flex>
        <Box overflowY="auto" padding="2" aria-live="polite" flex="1">
          {load.state === "loading" || load.state === "idle" ? (
            <Flex alignItems="center" gap="2" padding="4" color="fg.muted">
              <Spinner size="sm" /> Loading search...
            </Flex>
          ) : load.state === "failed" ? (
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
          ) : query.trim() === "" ? (
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
          ) : results.length === 0 ? (
            <Text margin="0" padding="4" color="fg.muted">
              No results for “{query}”. Try a broader term.
            </Text>
          ) : (
            <Box as="ul" margin="0" padding="0" role="listbox" aria-label={`${results.length} results`}>
              {results.map((result, position) => (
                <Box as="li" key={`${result.entry.slug}-${result.heading?.id ?? ""}`} listStyleType="none" role="option" aria-selected={position === selected}>
                  <Link
                    href={hrefOf({ result })}
                    display="block"
                    minHeight="64px"
                    padding="3"
                    borderRadius="lg"
                    bg={position === selected ? "nav.bgActive" : undefined}
                    textDecoration="none"
                    _hover={{ bg: "nav.bgHover", textDecoration: "none" }}
                    onMouseMove={() => setSelected(position)}
                  >
                    <Text as="span" display="block" fontSize="14px" lineHeight="20px" fontWeight="600" color="fg.muted">
                      <Highlighted text={result.entry.title} terms={terms} />
                    </Text>
                    {result.heading ? (
                      <Text as="span" display="block" fontSize="13px" lineHeight="20px" color="fg.muted">
                        {result.heading.text}
                      </Text>
                    ) : null}
                    <Text as="span" display="block" fontSize="12px" lineHeight="20px" color="fg.muted">
                      {result.entry.section}
                    </Text>
                    {result.entry.description ? (
                      <Text as="span" display="-webkit-box" fontSize="12px" lineHeight="20px" color="fg.muted" css={{ WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {result.entry.description}
                      </Text>
                    ) : null}
                  </Link>
                </Box>
              ))}
            </Box>
          )}
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

