import { Box, Flex, Icon, IconButton, Input, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type React from "react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTraceList } from "../../hooks/useTraceList";
import { useFindStore } from "../../stores/findStore";
import type { TraceListItem } from "../../types/trace";

const MIN_QUERY_LENGTH = 2;

function buildSearchableText(t: TraceListItem): string {
  const evalText = t.evaluations
    .map((e) => `${e.evaluatorName ?? ""} ${e.label ?? ""}`)
    .join(" ");
  const eventText = t.events.map((e) => e.name).join(" ");
  return [
    t.traceId,
    t.name,
    t.serviceName,
    t.input,
    t.output,
    t.error,
    t.errorSpanName,
    t.conversationId,
    t.userId,
    t.rootSpanName,
    t.models.join(" "),
    evalText,
    eventText,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
}

export const FindBar: React.FC = () => {
  const isOpen = useFindStore((s) => s.isOpen);
  const close = useFindStore((s) => s.close);

  const { data: traces } = useTraceList();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  // Deferred query keeps typing responsive even with thousands of rows.
  const deferredQuery = useDeferredValue(query);

  // Lazy per-trace lowercase text cache. Built on demand and invalidated
  // whenever the traces array reference changes.
  const cacheRef = useRef<{
    traces: TraceListItem[];
    map: Map<string, string>;
  }>({ traces: [], map: new Map() });
  if (cacheRef.current.traces !== traces) {
    cacheRef.current = { traces, map: new Map() };
  }

  const matches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (q.length < MIN_QUERY_LENGTH) return [] as string[];
    const cache = cacheRef.current.map;
    const out: string[] = [];
    for (const t of traces) {
      let text = cache.get(t.traceId);
      if (text === undefined) {
        text = buildSearchableText(t);
        cache.set(t.traceId, text);
      }
      if (text.includes(q)) out.push(t.traceId);
    }
    return out;
  }, [traces, deferredQuery]);

  // Reset to first match when match set changes.
  useEffect(() => {
    setCurrentIndex(0);
  }, [matches]);

  const currentTraceId = matches[currentIndex] ?? null;

  // Scroll the current match into view.
  useEffect(() => {
    if (!currentTraceId) return;
    const el = document.querySelector(
      `[data-trace-id="${CSS.escape(currentTraceId)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentTraceId]);

  // Auto-focus on open.
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen]);

  // CSS rule that highlights only the current match — avoids per-row
  // React subscriptions that would re-render up to 1000 rows on every
  // keystroke. The selector targets the data-trace-id on StatusRowGroup.
  const highlightCss = useMemo(() => {
    if (!currentTraceId) return null;
    const sel = `tbody[data-trace-id="${CSS.escape(currentTraceId)}"]`;
    return `
      ${sel} > tr > td {
        background-color: color-mix(in srgb, var(--chakra-colors-yellow-fg) 18%, transparent) !important;
      }
      ${sel} > tr:first-of-type > td {
        box-shadow: inset 0 2px 0 var(--chakra-colors-yellow-fg);
      }
      ${sel} > tr:last-of-type > td {
        box-shadow: inset 0 -2px 0 var(--chakra-colors-yellow-fg);
      }
    `;
  }, [currentTraceId]);

  if (!isOpen) {
    return null;
  }

  const stepNext = () => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  };

  const stepPrev = () => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) stepPrev();
      else stepNext();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      stepNext();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepPrev();
    }
  };

  const isSearching = query !== deferredQuery;
  const counterText =
    query.trim().length < MIN_QUERY_LENGTH
      ? null
      : isSearching
        ? "…"
        : matches.length === 0
          ? "No matches"
          : `${currentIndex + 1} of ${matches.length}`;

  return (
    <>
      {highlightCss && (
        <style dangerouslySetInnerHTML={{ __html: highlightCss }} />
      )}
      <Box
        position="absolute"
        top="8px"
        right="16px"
        zIndex={20}
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        shadow="lg"
        paddingX={2}
        paddingY={1.5}
        width="360px"
        role="search"
        aria-label="Find on page"
      >
        <Flex align="center" gap={1.5}>
          <Icon color="fg.subtle" boxSize="14px" flexShrink={0}>
            <Search />
          </Icon>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find in loaded traces…"
            variant="flushed"
            size="xs"
            flex={1}
            borderColor="transparent"
            _focus={{ borderColor: "transparent", boxShadow: "none" }}
            fontFamily="mono"
            fontSize="13px"
            aria-label="Find query"
          />
          {counterText && (
            <Text
              textStyle="2xs"
              color="fg.subtle"
              fontFamily="mono"
              flexShrink={0}
              whiteSpace="nowrap"
            >
              {counterText}
            </Text>
          )}
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={matches.length === 0}
            onClick={stepPrev}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Next match"
            disabled={matches.length === 0}
            onClick={stepNext}
          >
            <ChevronDown size={14} />
          </IconButton>
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Close find"
            onClick={close}
          >
            <X size={14} />
          </IconButton>
        </Flex>
      </Box>
    </>
  );
};
