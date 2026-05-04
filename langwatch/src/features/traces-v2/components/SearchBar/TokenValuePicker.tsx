import {
  Box,
  Button,
  chakra,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BookOpen, Check, Search } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";

const MAX_VALUES_PER_PAGE = 60;
const POPOVER_WIDTH = 320;

export interface TokenValuePickerAnchor {
  /** Bounding rect of the clicked token, used for absolute positioning. */
  rect: DOMRect;
  /** Liqe field name (e.g. "status", "model"). */
  field: string;
  /** Current value of the chip — highlighted in the list. */
  currentValue: string;
  /** Liqe-text-coordinate range of the Tag (for the swap mutation). */
  location: { start: number; end: number };
}

interface TokenValuePickerProps {
  anchor: TokenValuePickerAnchor | null;
  onClose: () => void;
}

/**
 * Floating popover that opens when a user clicks an existing
 * `field:value` chip in the search bar. Lists the discovered values for
 * that field (from the same `useTraceFacets` payload that drives the
 * sidebar) and rewrites the AST in place when one is picked, preserving
 * the chip's location, field name, and any wrapping NOT.
 *
 * Visual treatment mirrors `SuggestionDropdown` (the autocomplete that
 * pops while typing `field:`) so chip-edit and field-autocomplete read
 * as the same affordance — same shadow, glow ring, fade-in, mono row
 * layout, and footer with shortcut hints + syntax-docs button.
 */
export const TokenValuePicker: React.FC<TokenValuePickerProps> = ({
  anchor,
  onClose,
}) => {
  const setFacetValueAt = useFilterStore((s) => s.setFacetValueAt);
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  const { data: facets = [] } = useTraceFacets();
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset transient state whenever the anchor changes — opening for a
  // new chip should always start at the top with an empty filter, not
  // remember the prior chip's session.
  useEffect(() => {
    setFilter("");
    setActiveIndex(0);
  }, [anchor?.field, anchor?.location.start]);

  const values = useMemo(() => {
    if (!anchor) return [];
    const cat = facets.find(
      (d) => d.kind === "categorical" && d.key === anchor.field,
    );
    if (!cat || cat.kind !== "categorical") return [];
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? cat.topValues.filter((v) => v.value.toLowerCase().includes(q))
      : cat.topValues;
    return filtered.slice(0, MAX_VALUES_PER_PAGE);
  }, [facets, anchor, filter]);

  // Click-outside dismisses the popover. Listen on `mousedown` so the
  // dismiss fires before any subsequent click logic somewhere else.
  useEffect(() => {
    if (!anchor) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchor, onClose]);

  // Esc dismisses; arrow keys navigate; Enter commits.
  useEffect(() => {
    if (!anchor) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, values.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const next = values[activeIndex];
        if (next) {
          setFacetValueAt(anchor.location.start, anchor.location.end, next.value);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [anchor, values, activeIndex, onClose, setFacetValueAt]);

  if (!anchor) return null;
  if (typeof document === "undefined") return null;

  // Anchor below the chip with a small gap; clamp to viewport edges so
  // a chip near the right or bottom doesn't push the popover offscreen.
  const top = Math.min(window.innerHeight - 280, anchor.rect.bottom + 6);
  const left = Math.min(
    window.innerWidth - POPOVER_WIDTH - 8,
    Math.max(8, anchor.rect.left),
  );

  return createPortal(
    <Box
      ref={containerRef}
      position="fixed"
      top={`${top}px`}
      left={`${left}px`}
      borderRadius="lg"
      zIndex={2050}
      minWidth={`${POPOVER_WIDTH}px`}
      bg="bg.panel"
      boxShadow="0 0 0 1px var(--chakra-colors-border), 0 0 0 4px color-mix(in oklab, var(--chakra-colors-blue-solid) 14%, transparent), 0 18px 40px -12px color-mix(in oklab, #000 40%, transparent)"
      animation="token-value-picker-fade 120ms ease-out"
      css={{
        "@keyframes token-value-picker-fade": {
          from: { opacity: 0, transform: "translateY(-2px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
      onMouseDown={(e) => {
        // Stop the editor's own mousedown delegate from reading this
        // as a click outside the chip — keeps focus where it was.
        e.stopPropagation();
      }}
    >
      <Box
        borderRadius="lg"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        bg="bg.panel"
        position="relative"
      >
        <HStack
          paddingX={3}
          paddingY={2}
          gap={2}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.subtle"
        >
          <Search size={12} color="var(--chakra-colors-fg-subtle)" />
          <Input
            placeholder={`Filter ${anchor.field} values…`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActiveIndex(0);
            }}
            size="xs"
            variant="flushed"
            border="none"
            bg="transparent"
            paddingX={0}
            height="22px"
            fontSize="xs"
            fontFamily="mono"
            _focus={{ outline: "none", boxShadow: "none" }}
            autoFocus
          />
        </HStack>
        <VStack gap={0} align="stretch" maxHeight="320px" overflowY="auto">
          {values.length === 0 ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={3} paddingY={3}>
              No values match
            </Text>
          ) : (
            values.map((v, i) => {
              const isActive = i === activeIndex;
              const isCurrent = v.value === anchor.currentValue;
              return (
                <chakra.button
                  key={v.value}
                  type="button"
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  width="full"
                  paddingX={3}
                  paddingY={1.5}
                  textAlign="left"
                  bg={isActive ? "blue.solid/12" : "transparent"}
                  color="fg"
                  cursor="pointer"
                  _hover={{ bg: "blue.solid/8" }}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    setFacetValueAt(
                      anchor.location.start,
                      anchor.location.end,
                      v.value,
                    );
                    onClose();
                  }}
                >
                  <HStack gap={2} minWidth={0} flex={1}>
                    <Text textStyle="xs" fontFamily="mono" flexShrink={0}>
                      <Text as="span" color="fg.muted">
                        {anchor.field}
                      </Text>
                      <Text as="span" color="fg.muted">
                        :
                      </Text>
                      <Text
                        as="span"
                        color={isCurrent ? "blue.fg" : "fg"}
                        fontWeight={isCurrent ? "600" : "medium"}
                      >
                        {v.value}
                      </Text>
                    </Text>
                    {isCurrent && (
                      <Check
                        size={12}
                        color="var(--chakra-colors-blue-fg)"
                      />
                    )}
                  </HStack>
                  <Text
                    textStyle="2xs"
                    color="fg.subtle"
                    fontFamily="mono"
                    marginLeft={2}
                  >
                    {v.count.toLocaleString()}
                  </Text>
                </chakra.button>
              );
            })
          )}
        </VStack>
        <HStack
          gap={2}
          paddingX={3}
          paddingY={2}
          borderTopWidth="1px"
          borderColor="border"
          bg="bg.subtle"
          justify="space-between"
        >
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            ↑↓ navigate · ⏎ select · esc close
          </Text>
          <Button
            size="2xs"
            variant="ghost"
            color="blue.fg"
            onMouseDown={(event) => {
              event.preventDefault();
              setSyntaxHelpOpen(true);
            }}
          >
            <BookOpen size={11} />
            <Text textStyle="2xs">Syntax docs</Text>
          </Button>
        </HStack>
      </Box>
    </Box>,
    document.body,
  );
};
