import { Box, Flex, Icon, IconButton, Input } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type KeyboardEvent, useDeferredValue, useState } from "react";
import { useTraceList } from "../../hooks/useTraceList";
import { useFindStore } from "../../stores/findStore";
import { CurrentMatchHighlight } from "./CurrentMatchHighlight";
import { MatchCounter } from "./MatchCounter";
import { useAutoFocusInput } from "./useAutoFocusInput";
import { useMatchCycling } from "./useMatchCycling";
import { useScrollTraceIntoView } from "./useScrollTraceIntoView";
import { MIN_QUERY_LENGTH, useTraceSearchIndex } from "./useTraceSearchIndex";

const ICON_SIZE = 14;

export function FindBar() {
  const isOpen = useFindStore((s) => s.isOpen);
  const close = useFindStore((s) => s.close);
  const { data: traces } = useTraceList();

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const matches = useTraceSearchIndex({ traces, query: deferredQuery });
  const { currentIndex, currentId, next, prev } = useMatchCycling(matches);

  const inputRef = useAutoFocusInput(isOpen);
  useScrollTraceIntoView(currentId);

  if (!isOpen) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        if (event.shiftKey) prev();
        else next();
        return;
      case "Escape":
        event.preventDefault();
        close();
        return;
      case "ArrowDown":
        event.preventDefault();
        next();
        return;
      case "ArrowUp":
        event.preventDefault();
        prev();
    }
  };

  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const isSearching = query !== deferredQuery;
  const noMatches = matches.length === 0;

  return (
    <>
      <CurrentMatchHighlight traceId={currentId} />
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
          <Icon color="fg.subtle" boxSize={`${ICON_SIZE}px`} flexShrink={0}>
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
            textStyle="xs"
            aria-label="Find query"
          />
          {hasQuery && (
            <MatchCounter
              isSearching={isSearching}
              matchCount={matches.length}
              currentIndex={currentIndex}
            />
          )}
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={noMatches}
            onClick={prev}
          >
            <ChevronUp size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Next match"
            disabled={noMatches}
            onClick={next}
          >
            <ChevronDown size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Close find"
            onClick={close}
          >
            <X size={ICON_SIZE} />
          </IconButton>
        </Flex>
      </Box>
    </>
  );
}
