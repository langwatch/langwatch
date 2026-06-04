import { Box, Flex, Icon, IconButton, Input, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type KeyboardEvent, useDeferredValue, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useTraceList } from "../../hooks/useTraceList";
import { useFindStore } from "../../stores/findStore";
import { CurrentMatchHighlight } from "./CurrentMatchHighlight";
import { MatchCounter } from "./MatchCounter";
import { useAutoFocusInput } from "./useAutoFocusInput";
import { useMatchCycling } from "./useMatchCycling";
import { useScrollTraceIntoView } from "./useScrollTraceIntoView";
import { MIN_QUERY_LENGTH, useTraceSearchIndex } from "./useTraceSearchIndex";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_KEY_SYMBOL = IS_MAC ? "⌘" : "Ctrl";

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
      {/* Separate banner under the FindBar — distinct surface (blue tint,
          gap from the bar above) so the hint reads as its own callout
          rather than fine-print under the search input. Used to sit
          under the *main* search bar where it felt like ambient noise
          for users who never opened Find; promoting it here means it
          only shows while LW's find is actually open AND it visually
          breaks out from the search surface so the eye notices it. */}
      <Box
        position="absolute"
        top="56px"
        right="16px"
        zIndex={20}
        width="360px"
        bg="blue.subtle"
        borderWidth="1px"
        borderColor="blue.muted"
        borderRadius="md"
        paddingX={3}
        paddingY={1.5}
        shadow="sm"
        role="note"
        aria-label="Find shortcut hint"
      >
        <Text
          as="span"
          color="blue.fg"
          fontSize="2xs"
          lineHeight="1.4"
          display="inline-flex"
          alignItems="center"
          gap={1}
        >
          Press <Kbd>{MOD_KEY_SYMBOL}</Kbd>
          <Kbd>F</Kbd> again to switch to your browser's find.
        </Text>
      </Box>
    </>
  );
}
