import {
  Box,
  Button,
  chakra,
  HStack,
  Icon,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BookOpen, Check, Plus, Search } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFacetSearch } from "../../hooks/useFacetSearch";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seededOpenKey = useRef<string | null>(null);

  // Prefill the input with the chip's current value so the user can edit it
  // as text (not just filter the list) — clicking a chip should let you tweak
  // the value directly, as well as pick from the dropdown. Re-seeds whenever
  // the picker opens for a different chip.
  useEffect(() => {
    setFilter(anchor?.currentValue ?? "");
    setActiveIndex(0);
  }, [anchor?.field, anchor?.location.start, anchor?.currentValue]);

  // Focus the search input when the picker OPENS — deferred to the next
  // frame so it wins the race against the chip-click that opened it
  // (a plain `autoFocus` fires mid-mount and the opening click can steal
  // focus straight back, which read as "the popover stole my cursor and
  // I can't type"). Keyed to the anchor identity, NOT to `filter`, so it
  // never re-fires on keystrokes — re-focusing on every change would
  // snap the caret to the end and make clicking mid-text to reposition
  // impossible. See specs/traces-v2/filter-bar-interactions.feature
  useEffect(() => {
    if (!anchor) return;
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      // Select the whole prefilled value so the first keystroke replaces it
      // (retype from scratch) while a deliberate click still drops the caret
      // mid-text to tweak a few characters.
      el.setSelectionRange(0, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor?.field, anchor?.location.start]);

  // Resolve this chip's field to a categorical descriptor. Lifted above the
  // value memo so the server-search hook's `enabled` can depend on it.
  // `facetValues` only accepts categorical facets, so a non-categorical /
  // unknown field leaves `cat` undefined and the picker shows nothing.
  const cat = useMemo(() => {
    if (!anchor) return undefined;
    const found = facets.find(
      (d) => d.kind === "categorical" && d.key === anchor.field,
    );
    return found && found.kind === "categorical" ? found : undefined;
  }, [facets, anchor]);

  // "Pristine" = the input still holds the chip's unedited value (or is
  // empty). While pristine the picker reads as a dropdown of alternatives —
  // show the full preloaded top-N and DON'T hit the server. Once the user
  // edits the text we switch to a server-side prefix search so a value beyond
  // the preloaded top-N can be found and picked.
  const pristine =
    !anchor ||
    filter.trim() === "" ||
    filter.trim().toLowerCase() === anchor.currentValue.trim().toLowerCase();

  const serverSearch = useFacetSearch({
    facetKey: anchor?.field ?? "",
    prefix: filter,
    enabled: !!cat && !pristine,
  });

  const values = useMemo<
    { value: string; label?: string; count: number }[]
  >(() => {
    if (!anchor || !cat) return [];
    // Pristine → the preloaded alternatives. Edited → server-side prefix
    // results matched against ALL values (the server matches value AND label),
    // not just the preloaded top-N. Annotated to the common shape so `.map`
    // resolves over the two source arrays without a union-of-arrays call error.
    const source: { value: string; label?: string; count: number }[] = pristine
      ? cat.topValues
      : serverSearch.values;
    return source
      .map((v) => ({ value: v.value, label: v.label, count: v.count }))
      .slice(0, MAX_VALUES_PER_PAGE);
  }, [anchor, cat, pristine, serverSearch.values]);

  // On open, move the highlight onto the current value's row so ↑↓ starts
  // from where the user is and a bare Enter re-commits the current value (a
  // no-op) rather than jumping to whichever value sorts first. Guarded so it
  // seeds once per open — it must not fight the user's own navigation once
  // they start editing. Waits until the prefill has landed (filter === the
  // current value) so it reads this chip's full list, not a stale one.
  useEffect(() => {
    if (!anchor) {
      seededOpenKey.current = null;
      return;
    }
    const key = `${anchor.field}:${anchor.location.start}`;
    if (seededOpenKey.current === key) return;
    if (filter !== anchor.currentValue) return;
    const idx = values.findIndex((v) => v.value === anchor.currentValue);
    setActiveIndex(idx >= 0 ? idx : 0);
    seededOpenKey.current = key;
  }, [anchor, values, filter]);

  // "Use <typed> as a new value" CTA — surfaced when the user has
  // typed something that doesn't exactly match a known value's id.
  // Commits whatever was typed verbatim (the query language is
  // ID-rooted; the operator is telling us they know the id is rare
  // / new / not yet ingested). Trimmed of surrounding whitespace.
  const trimmedFilter = filter.trim();
  const exactValueMatch = values.some((v) => {
    const lower = trimmedFilter.toLowerCase();
    return (
      v.value.toLowerCase() === lower ||
      // The picker now resolves by id AND label, so an exact label hit
      // (e.g. typing "Faithfulness" against an evaluator whose id is a
      // hash) must also suppress the "use as new value" custom row.
      (v.label !== undefined && v.label.toLowerCase() === lower)
    );
  });
  const customValue =
    trimmedFilter.length > 0 && !exactValueMatch ? trimmedFilter : null;
  // Total interactive rows for keyboard navigation: known values
  // followed by the optional custom-value row at the end.
  const interactiveRowCount = values.length + (customValue ? 1 : 0);
  const isCustomRowActive =
    customValue !== null && activeIndex === values.length;

  // Click-outside dismisses the popover. Listen on `mousedown` so the
  // dismiss fires before any subsequent click logic somewhere else.
  useEffect(() => {
    if (!anchor) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        containerRef.current &&
        target &&
        containerRef.current.contains(target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchor, onClose]);

  // Esc dismisses; arrow keys navigate; Enter commits.
  // Scoped to the picker container — NOT the document — so peer
  // document-level handlers (a host dialog's "close on Esc", the
  // search bar's own Enter/Arrow shortcuts) don't fire alongside us
  // for keys the picker is consuming. `stopPropagation` on the same
  // event keeps the keystroke from bubbling further up the DOM tree
  // toward those peers; without scoping AND stopping, the picker
  // would race with whatever else listens at document.
  useEffect(() => {
    if (!anchor) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => Math.min(i + 1, interactiveRowCount - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        // Custom row → commit the typed text verbatim. Known row →
        // commit its id.
        if (isCustomRowActive && customValue) {
          setFacetValueAt(
            anchor.location.start,
            anchor.location.end,
            customValue,
          );
          onClose();
          return;
        }
        const next = values[activeIndex];
        if (next) {
          setFacetValueAt(
            anchor.location.start,
            anchor.location.end,
            next.value,
          );
          onClose();
        }
      }
    };
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
  }, [
    anchor,
    values,
    activeIndex,
    onClose,
    setFacetValueAt,
    interactiveRowCount,
    isCustomRowActive,
    customValue,
  ]);

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
            _focus={{ outline: "none", boxShadow: "none" }}
            ref={inputRef}
          />
        </HStack>
        <VStack gap={0} align="stretch" maxHeight="320px" overflowY="auto">
          {values.length === 0 && !customValue ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={3} paddingY={3}>
              No values match
            </Text>
          ) : (
            <>
              {values.map((v, i) => {
                const isActive = i === activeIndex;
                const isCurrent = v.value === anchor.currentValue;
                // Display name when the resolver emitted one and it
                // differs from the raw id; muted id rendered on the
                // right so the operator always sees what they're
                // about to commit.
                const displayLabel =
                  v.label && v.label !== v.value ? v.label : null;
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
                      <Text textStyle="xs" flexShrink={0}>
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
                          {displayLabel ?? v.value}
                        </Text>
                      </Text>
                      {displayLabel && (
                        <Text
                          textStyle="2xs"
                          color="fg.subtle"
                          fontFamily="mono"
                          truncate
                          minWidth={0}
                          flexShrink={1}
                        >
                          {v.value}
                        </Text>
                      )}
                      {isCurrent && (
                        <Check size={12} color="var(--chakra-colors-blue-fg)" />
                      )}
                    </HStack>
                    <Text textStyle="2xs" color="fg.subtle" marginLeft={2}>
                      {v.count.toLocaleString()}
                    </Text>
                  </chakra.button>
                );
              })}
              {customValue && (
                // Custom-value row — committed verbatim as the field's
                // value. Surfaced when the typed text doesn't match a
                // known id; the operator is telling us they know
                // exactly which id they want (rare value, new
                // evaluator, paste from a log). Renders below the
                // known values so it never displaces a top-N match.
                <chakra.button
                  key="__custom__"
                  type="button"
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  width="full"
                  paddingX={3}
                  paddingY={1.5}
                  textAlign="left"
                  bg={isCustomRowActive ? "blue.solid/12" : "transparent"}
                  color="fg"
                  cursor="pointer"
                  borderTopWidth={values.length > 0 ? "1px" : undefined}
                  borderTopColor="border.subtle"
                  _hover={{ bg: "blue.solid/8" }}
                  onMouseEnter={() => setActiveIndex(values.length)}
                  onClick={() => {
                    setFacetValueAt(
                      anchor.location.start,
                      anchor.location.end,
                      customValue,
                    );
                    onClose();
                  }}
                >
                  <HStack gap={2} minWidth={0} flex={1}>
                    <Icon as={Plus} boxSize={3} color="fg.subtle" />
                    <Text textStyle="xs" flexShrink={0}>
                      <Text as="span" color="fg.muted">
                        Use as {anchor.field}:
                      </Text>
                      <Text
                        as="span"
                        color="fg"
                        fontWeight="medium"
                        fontFamily="mono"
                      >
                        {customValue}
                      </Text>
                    </Text>
                  </HStack>
                </chakra.button>
              )}
            </>
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
          <Text textStyle="2xs" color="fg.subtle">
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
