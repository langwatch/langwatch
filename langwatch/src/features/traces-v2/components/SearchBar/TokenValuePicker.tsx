import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Check, Search } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import { useFilterStore } from "../../stores/filterStore";

const MAX_VALUES_PER_PAGE = 60;

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
 */
export const TokenValuePicker: React.FC<TokenValuePickerProps> = ({
  anchor,
  onClose,
}) => {
  const setFacetValueAt = useFilterStore((s) => s.setFacetValueAt);
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

  // Read the candidate value list for this chip's field from the
  // discover payload. Match the categorical descriptor by `key` and
  // pull `topValues` — same source of truth the sidebar facet rows
  // use, so the picker shows exactly what's available.
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
  // dismiss fires before any subsequent click logic somewhere else (the
  // search-bar editor itself, for instance).
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

  // Anchor below the chip with a small gap. If the chip is near the
  // viewport bottom, ProseMirror won't let us reposition automatically,
  // so we just clamp to a sensible top — the popover is short enough
  // that this is rare.
  const top = Math.min(
    window.innerHeight - 240,
    anchor.rect.bottom + 4,
  );
  const left = Math.min(
    window.innerWidth - 280,
    Math.max(8, anchor.rect.left),
  );

  return createPortal(
    <Box
      ref={containerRef}
      position="fixed"
      top={`${top}px`}
      left={`${left}px`}
      width="260px"
      maxHeight="240px"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      boxShadow="lg"
      zIndex={50}
      overflow="hidden"
      onMouseDown={(e) => {
        // Stop the editor's own mousedown delegate from reading this
        // as a click outside the chip — keeps focus where it was.
        e.stopPropagation();
      }}
    >
      <VStack align="stretch" gap={0}>
        <HStack
          paddingX={2}
          paddingY={1.5}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          gap={1.5}
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
            _focus={{ outline: "none", boxShadow: "none" }}
            autoFocus
          />
        </HStack>
        <VStack align="stretch" gap={0} overflowY="auto" maxHeight="200px">
          {values.length === 0 ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={3} paddingY={3}>
              No values match
            </Text>
          ) : (
            values.map((v, i) => {
              const isActive = i === activeIndex;
              const isCurrent = v.value === anchor.currentValue;
              return (
                <HStack
                  key={v.value}
                  paddingX={2}
                  paddingY={1.5}
                  cursor="pointer"
                  bg={isActive ? "bg.muted" : undefined}
                  _hover={{ bg: "bg.muted" }}
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
                  <Text
                    textStyle="xs"
                    color={isCurrent ? "blue.fg" : "fg"}
                    fontWeight={isCurrent ? "600" : "400"}
                    flex={1}
                    truncate
                  >
                    {v.value}
                  </Text>
                  <Text
                    textStyle="2xs"
                    color="fg.subtle"
                    fontFamily="mono"
                    flexShrink={0}
                  >
                    {v.count.toLocaleString()}
                  </Text>
                  {isCurrent && (
                    <Check size={12} color="var(--chakra-colors-blue-fg)" />
                  )}
                </HStack>
              );
            })
          )}
        </VStack>
      </VStack>
    </Box>,
    document.body,
  );
};
