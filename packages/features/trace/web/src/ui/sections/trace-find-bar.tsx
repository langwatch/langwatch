import { Box, Flex, Icon, IconButton, Input, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useDeferredValue, useState } from "react";

import { useFindStore } from "../../behavior/find-store";
import { useFindAutoFocusInput } from "../../behavior/find-auto-focus-input";
import { useFindMatchCycling } from "../../behavior/find-match-cycling";
import { FindMatchCounter } from "../elements/find-match-counter";
import { FindMatchHighlight } from "../elements/find-match-highlight";
import { useFindScrollTraceIntoView } from "../../behavior/find-scroll-trace-into-view";
import { MIN_QUERY_LENGTH, useTraceSearchIndex, type TraceSearchItem } from "../../behavior/find-search-index";

type TraceFindBarProps = {
  traces: TraceSearchItem[];
  renderShortcutKey: (label: string) => ReactNode;
};

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_KEY_SYMBOL = IS_MAC ? "⌘" : "Ctrl";
const ICON_SIZE = 14;

export function TraceFindBar({ traces, renderShortcutKey }: TraceFindBarProps) {
  const isOpen = useFindStore((state) => state.isOpen);
  const close = useFindStore((state) => state.close);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const matches = useTraceSearchIndex({ traces, query: deferredQuery });
  const { currentIndex, currentId, next, previous } = useFindMatchCycling(matches);

  const inputRef = useFindAutoFocusInput(isOpen);
  useFindScrollTraceIntoView(currentId);

  if (!isOpen) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (event.shiftKey) previous();
        else next();
        return;
      }
      case "Escape": {
        event.preventDefault();
        close();
        return;
      }
      case "ArrowDown": {
        event.preventDefault();
        next();
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        previous();
      }
    }
  };

  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const isSearching = query !== deferredQuery;
  const noMatches = matches.length === 0;

  return (
    <>
      <FindMatchHighlight traceId={currentId} />
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
        data-find-bar
      >
        <Flex align="center" gap={1.5}>
          <Icon color="fg.subtle" boxSize={`${ICON_SIZE}px`} flexShrink={0}>
            <Search />
          </Icon>
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            <FindMatchCounter
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
            onClick={previous}
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
          <IconButton size="2xs" variant="ghost" aria-label="Close find" onClick={close}>
            <X size={ICON_SIZE} />
          </IconButton>
        </Flex>
      </Box>
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
          Press {renderShortcutKey(MOD_KEY_SYMBOL)} {renderShortcutKey("F")} again to switch to your
          browser's find.
        </Text>
      </Box>
    </>
  );
}
