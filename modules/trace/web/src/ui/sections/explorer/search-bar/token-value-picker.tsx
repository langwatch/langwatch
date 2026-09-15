import { Box, Button, chakra, HStack, Icon, Input, Text, VStack } from "@chakra-ui/react";
import { BookOpen, Check, Plus, Search } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDebouncedValue } from "../../../../behavior/explorer/use-debounced-value.ts";
import { useFacetSearch } from "../hooks/use-facet-search.ts";
import { useTraceFacets } from "../hooks/use-trace-facets.ts";
import { useFilterStore } from "../../../../behavior/filter.store.ts";
import { useUIStore } from "../../../../behavior/ui.store.ts";
import { dedupeByValue } from "../../../../model/dedupe-by-value.ts";

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
 * Floating popover that opens when a user clicks an existing `field:value` chip in the
 * search bar.
 */
export const TokenValuePicker: React.FC<TokenValuePickerProps> = ({ anchor, onClose }) => {
  const setFacetValueAt = useFilterStore((s) => s.setFacetValueAt);
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  const { data: facets = [] } = useTraceFacets();
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seededOpenKey = useRef<string | null>(null);
  // Anchor (`field:start`) the `filter` has been (re)seeded for. Gates the
  // server query so a direct chip-to-chip switch can't fire for the new field
  // carrying the previous chip's text — `anchor` changes one render before the
  // reseed effect below resets `filter`. Same keyed-ref idiom as seededOpenKey.
  const filterSeededAnchorKey = useRef<string | null>(null);

  // Prefill the input with the chip's current value so the user can edit it
  // as text (not just filter the list) — clicking a chip should let you tweak
  // the value directly, as well as pick from the dropdown. Re-seeds whenever
  // the picker opens for a different chip.
  useEffect(() => {
    setFilter(anchor?.currentValue ?? "");
    setActiveIndex(0);
    filterSeededAnchorKey.current = anchor ? `${anchor.field}:${anchor.location.start}` : null;
  }, [anchor?.field, anchor?.location.start, anchor?.currentValue]);

  // Deferred to the next frame so focus wins the race against the chip-click that opened the
  // picker — a plain `autoFocus` fires mid-mount and the opening click can steal it right back.
  useEffect(
    () => (anchor ? focusAndSelectValue(inputRef) : undefined),
    [anchor?.field, anchor?.location.start],
  );

  // Resolve this chip's field to a categorical descriptor. Lifted above the
  // value memo so the server-search hook's `enabled` can depend on it.
  // `facetValues` only accepts categorical facets, so a non-categorical /
  // unknown field leaves `cat` undefined and the picker shows nothing.
  const cat = useMemo(() => categoricalFacet(facets, anchor?.field), [facets, anchor]);

  // "Pristine" = the input still holds the chip's unedited value (or is
  // empty). While pristine the picker reads as a dropdown of alternatives —
  // show the full preloaded top-N and DON'T hit the server. Once the user
  // edits the text we switch to a server-side prefix search so a value beyond
  // the preloaded top-N can be found and picked.
  const pristine = isPristineText(filter, anchor?.currentValue);

  // Debounce the typed text before it hits the server — a per-keystroke `facetValues`
  // prefix scan over a high-cardinality facet is a real ClickHouse round-trip.
  const debouncedFilter = useDebouncedValue(filter, 300);
  const serverPristine = isPristineText(debouncedFilter, anchor?.currentValue);

  // Gated on both: `serverPristine` waits for typing to settle before fetching, while the live
  // `pristine` disables the query instantly when text returns to the chip's value.
  const serverSearch = useFacetSearch({
    facetKey: anchor?.field ?? "",
    prefix: debouncedFilter,
    enabled: shouldSearchServer({
      anchor,
      hasCategoricalFacet: !!cat,
      pristine,
      seededAnchorKey: filterSeededAnchorKey.current,
      serverPristine,
    }),
  });

  const values = useMemo(
    () => pickerValues({ cat, filter, pristine, serverValues: serverSearch.values }),
    [anchor, cat, pristine, serverSearch.values, filter],
  );

  // On open, move the highlight onto the current value's row so ↑↓ starts from where
  // the user is and a bare Enter re-commits the current value (a no-op) rather than
  // jumping to whichever value sorts first.
  useEffect(() => {
    seedActiveIndex({ anchor, filter, seededOpenKey, setActiveIndex, values });
  }, [anchor, values, filter]);

  // "Use <typed> as a new value" CTA — surfaced when the user has
  // typed something that doesn't exactly match a known value's id.
  // Commits whatever was typed verbatim (the query language is
  // ID-rooted; the operator is telling us they know the id is rare
  // / new / not yet ingested). Trimmed of surrounding whitespace.
  const { customValue, interactiveRowCount, isCustomRowActive } = customRowState({
    activeIndex,
    filter,
    values,
  });

  // Click-outside dismisses the popover. Listen on `mousedown` so the
  // dismiss fires before any subsequent click logic somewhere else.
  useEffect(
    () => (anchor ? listenForOutsideMouseDown(containerRef, onClose) : undefined),
    [anchor, onClose],
  );

  // Esc dismisses; arrow keys navigate; Enter commits.
  useEffect(() => {
    if (!anchor) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: KeyboardEvent) =>
      applyPickerKey({
        activeIndex,
        anchor,
        customValue,
        e,
        interactiveRowCount,
        isCustomRowActive,
        onClose,
        setActiveIndex,
        setFacetValueAt,
        values,
      });
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
  const left = Math.min(window.innerWidth - POPOVER_WIDTH - 8, Math.max(8, anchor.rect.left));

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
        <PickerValueList
          activeIndex={activeIndex}
          anchor={anchor}
          customValue={customValue}
          isCustomRowActive={isCustomRowActive}
          onClose={onClose}
          setActiveIndex={setActiveIndex}
          setFacetValueAt={setFacetValueAt}
          values={values}
        />
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

/**
 * Focus deferred to the next frame so it wins the race against the chip click
 * that opened the picker — a plain `autoFocus` fires mid-mount and the opening
 * click steals it straight back. The whole prefilled value is selected so the
 * first keystroke replaces it, while a deliberate click still drops the caret
 * mid-text.
 */
function focusAndSelectValue(inputRef: { current: HTMLInputElement | null }): () => void {
  const raf = requestAnimationFrame(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * The chip's field as a categorical descriptor. `facetValues` only accepts
 * categorical facets, so a non-categorical or unknown field resolves to nothing
 * and the picker shows nothing.
 */
function categoricalFacet(
  facets: NonNullable<ReturnType<typeof useTraceFacets>["data"]>,
  field: string | undefined,
) {
  const found = facets.find((d) => d.kind === "categorical" && d.key === field);
  return found && found.kind === "categorical" ? found : undefined;
}

/**
 * The server prefix search only runs once the typing has settled AND the seeded
 * anchor still names this chip, so a direct chip-to-chip switch cannot fire for
 * the new field carrying the previous chip's text.
 */
function shouldSearchServer({
  anchor,
  hasCategoricalFacet,
  pristine,
  seededAnchorKey,
  serverPristine,
}: {
  anchor: TokenValuePickerProps["anchor"];
  hasCategoricalFacet: boolean;
  pristine: boolean;
  seededAnchorKey: string | null;
  serverPristine: boolean;
}): boolean {
  if (!hasCategoricalFacet || pristine || serverPristine) return false;
  return seededAnchorKey === (anchor ? `${anchor.field}:${anchor.location.start}` : null);
}

/**
 * The "Use <typed> as a new value" row, surfaced when the typed text matches no
 * known value's id or label, plus the keyboard navigation bounds it changes.
 */
function customRowState({
  activeIndex,
  filter,
  values,
}: {
  activeIndex: number;
  filter: string;
  values: { value: string; label?: string }[];
}): { customValue: string | null; interactiveRowCount: number; isCustomRowActive: boolean } {
  const trimmed = filter.trim();
  const customValue = trimmed.length > 0 && !hasExactValue(values, trimmed) ? trimmed : null;
  return {
    customValue,
    interactiveRowCount: values.length + (customValue === null ? 0 : 1),
    isCustomRowActive: customValue !== null && activeIndex === values.length,
  };
}

/**
 * "Pristine" means the input still holds the chip's unedited value, or is
 * empty. While pristine the picker reads as a dropdown of alternatives: the full
 * preloaded top-N, and no server round-trip. Once the text is edited it becomes
 * a server-side prefix search, so a value beyond the preloaded top-N can be
 * found and picked.
 */
function isPristineText(text: string, currentValue: string | undefined): boolean {
  if (currentValue === undefined) return true;
  const trimmed = text.trim();
  return trimmed === "" || trimmed.toLowerCase() === currentValue.trim().toLowerCase();
}

/** The rows the picker offers: the preloaded alternatives, or the search hits. */
function pickerValues({
  cat,
  filter,
  pristine,
  serverValues,
}: {
  cat: { topValues: { value: string; label?: string; count: number }[] } | undefined;
  filter: string;
  pristine: boolean;
  serverValues: { value: string; label?: string; count: number }[];
}): { value: string; label?: string; count: number }[] {
  if (!cat) return [];
  const source = pristine ? cat.topValues : dedupeByValue([...cat.topValues, ...serverValues]);
  const q = pristine ? "" : filter.trim().toLowerCase();
  return source
    .filter(
      (v) =>
        !q || v.value.toLowerCase().includes(q) || (v.label?.toLowerCase().includes(q) ?? false),
    )
    .map((v) => ({ value: v.value, label: v.label, count: v.count }))
    .slice(0, MAX_VALUES_PER_PAGE);
}

/**
 * On open the highlight moves onto the current value's row, so the arrow keys
 * start from where the reader is and a bare Enter re-commits the current value
 * rather than jumping to whichever value sorts first.
 */
function seedActiveIndex({
  anchor,
  filter,
  seededOpenKey,
  setActiveIndex,
  values,
}: {
  anchor: TokenValuePickerProps["anchor"];
  filter: string;
  seededOpenKey: { current: string | null };
  setActiveIndex: (index: number) => void;
  values: { value: string }[];
}): void {
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
}

/**
 * Whether the typed text already names a row. The picker resolves by id AND
 * label, so an exact label hit — typing "Faithfulness" against an evaluator
 * whose id is a hash — also suppresses the "use as a new value" row.
 */
function hasExactValue(values: { value: string; label?: string }[], trimmed: string): boolean {
  const lower = trimmed.toLowerCase();
  return values.some(
    (v) =>
      v.value.toLowerCase() === lower || (v.label !== undefined && v.label.toLowerCase() === lower),
  );
}

/** Dismisses the popover on any mousedown outside it, before other click logic runs. */
function listenForOutsideMouseDown(
  containerRef: { current: HTMLDivElement | null },
  onClose: () => void,
): () => void {
  const handler = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (containerRef.current && target && containerRef.current.contains(target)) return;
    onClose();
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}

/** Commits the highlighted row: the typed text verbatim, or a known value's id. */
function commitActiveRow({
  activeIndex,
  anchor,
  customValue,
  isCustomRowActive,
  onClose,
  setFacetValueAt,
  values,
}: {
  activeIndex: number;
  anchor: NonNullable<TokenValuePickerProps["anchor"]>;
  customValue: string | null;
  isCustomRowActive: boolean;
  onClose: () => void;
  setFacetValueAt: ReturnType<typeof useFilterStore.getState>["setFacetValueAt"];
  values: { value: string }[];
}): void {
  if (isCustomRowActive && customValue) {
    setFacetValueAt(anchor.location.start, anchor.location.end, customValue);
    onClose();
    return;
  }
  const next = values[activeIndex];
  if (!next) return;
  setFacetValueAt(anchor.location.start, anchor.location.end, next.value);
  onClose();
}

/** Escape dismisses, the arrow keys navigate, Enter commits. */
function applyPickerKey({
  activeIndex,
  anchor,
  customValue,
  e,
  interactiveRowCount,
  isCustomRowActive,
  onClose,
  setActiveIndex,
  setFacetValueAt,
  values,
}: {
  activeIndex: number;
  anchor: NonNullable<TokenValuePickerProps["anchor"]>;
  customValue: string | null;
  e: KeyboardEvent;
  interactiveRowCount: number;
  isCustomRowActive: boolean;
  onClose: () => void;
  setActiveIndex: (update: (index: number) => number) => void;
  setFacetValueAt: ReturnType<typeof useFilterStore.getState>["setFacetValueAt"];
  values: { value: string }[];
}): void {
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
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();
  commitActiveRow({
    activeIndex,
    anchor,
    customValue,
    isCustomRowActive,
    onClose,
    setFacetValueAt,
    values,
  });
}

/** The picker's rows: the known values, then the optional custom-value row. */
function PickerValueList({
  activeIndex,
  anchor,
  customValue,
  isCustomRowActive,
  onClose,
  setActiveIndex,
  setFacetValueAt,
  values,
}: {
  activeIndex: number;
  anchor: NonNullable<TokenValuePickerProps["anchor"]>;
  customValue: string | null;
  isCustomRowActive: boolean;
  onClose: () => void;
  setActiveIndex: (index: number) => void;
  setFacetValueAt: ReturnType<typeof useFilterStore.getState>["setFacetValueAt"];
  values: { value: string; label?: string; count: number }[];
}) {
  return (
    <VStack gap={0} align="stretch" maxHeight="320px" overflowY="auto">
      {values.length === 0 && !customValue ? (
        <Text textStyle="2xs" color="fg.subtle" paddingX={3} paddingY={3}>
          No values match
        </Text>
      ) : (
        <>
          {values.map((v, i) => (
            <PickerValueRow
              key={v.value}
              anchor={anchor}
              index={i}
              isActive={i === activeIndex}
              onClose={onClose}
              setActiveIndex={setActiveIndex}
              setFacetValueAt={setFacetValueAt}
              value={v}
            />
          ))}
          {customValue && (
            // Custom-value row — committed verbatim as the field's value.
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
                setFacetValueAt(anchor.location.start, anchor.location.end, customValue);
                onClose();
              }}
            >
              <HStack gap={2} minWidth={0} flex={1}>
                <Icon as={Plus} boxSize={3} color="fg.subtle" />
                <Text textStyle="xs" flexShrink={0}>
                  <Text as="span" color="fg.muted">
                    Use as {anchor.field}:
                  </Text>
                  <Text as="span" color="fg" fontWeight="medium" fontFamily="mono">
                    {customValue}
                  </Text>
                </Text>
              </HStack>
            </chakra.button>
          )}
        </>
      )}
    </VStack>
  );
}

/**
 * One known value. The display name shows when the resolver emitted one that
 * differs from the raw id, with the muted id beside it so the reader always sees
 * what they are about to commit.
 */
function PickerValueRow({
  anchor,
  index,
  isActive,
  onClose,
  setActiveIndex,
  setFacetValueAt,
  value,
}: {
  anchor: NonNullable<TokenValuePickerProps["anchor"]>;
  index: number;
  isActive: boolean;
  onClose: () => void;
  setActiveIndex: (index: number) => void;
  setFacetValueAt: ReturnType<typeof useFilterStore.getState>["setFacetValueAt"];
  value: { value: string; label?: string; count: number };
}) {
  const isCurrent = value.value === anchor.currentValue;
  // Display name when the resolver emitted one and it
  // differs from the raw id; muted id rendered on the
  // right so the operator always sees what they're
  // about to commit.
  const displayLabel = value.label && value.label !== value.value ? value.label : null;
  return (
    <chakra.button
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
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => {
        setFacetValueAt(anchor.location.start, anchor.location.end, value.value);
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
            {displayLabel ?? value.value}
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
            {value.value}
          </Text>
        )}
        {isCurrent && <Check size={12} color="var(--chakra-colors-blue-fg)" />}
      </HStack>
      <Text textStyle="2xs" color="fg.subtle" marginLeft={2}>
        {value.count.toLocaleString()}
      </Text>
    </chakra.button>
  );
}
