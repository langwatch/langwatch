import { Button, Input, Link, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AttributeKeyRow } from "./AttributeKeyRow";
import { MAX_VISIBLE_ATTRIBUTE_KEYS } from "./constants";
import { SidebarSection } from "./SidebarSection";
import type { AttributeKey, FacetValueState } from "./types";

interface AttributesSectionProps {
  /**
   * Section title — varies by attribute flavour ("Trace attributes",
   * "Span attributes"). Owned by the section data so the same component
   * renders both flavours unchanged.
   */
  title: string;
  keys: AttributeKey[];
  icon?: React.ElementType;
  /** Active filter state per `<prefix>.<key>:<value>` */
  getValueState: (attrKey: string, value: string) => FacetValueState;
  /** Active state for `none:<prefix>.<key>` */
  getNoneActive: (attrKey: string) => boolean;
  onToggleValue: (attrKey: string, value: string) => void;
  onToggleNone: (attrKey: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onShiftToggle?: (nextOpen: boolean) => void;
  /** Remove this section from the sidebar (per-user). */
  onHide?: () => void;
  /**
   * Cosmetic prefix stripped from each key's DISPLAYED label (e.g.
   * `metadata.`). The full `key.value` still drives filtering, value loading,
   * and active-state lookups — only the label and the local key-filter match
   * against the stripped form. Absent on the trace/span/event sections.
   */
  displayStripPrefix?: string;
  /**
   * When set, the section renders even with zero keys and shows an empty state
   * linking here (how to emit these attributes). Used by the Metadata facet so
   * it stays discoverable and teaches rather than disappearing.
   */
  emptyDocsHref?: string;
}

/** Strip a leading prefix for display; leave non-matching keys untouched. */
function stripPrefix(key: string, prefix: string | undefined): string {
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

const AttributesSectionInner: React.FC<AttributesSectionProps> = ({
  title,
  keys,
  icon,
  getValueState,
  getNoneActive,
  onToggleValue,
  onToggleNone,
  dragHandleProps,
  onShiftToggle,
  onHide,
  displayStripPrefix,
  emptyDocsHref,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  // The key filter is hidden by default; the SidebarSection header renders a
  // list-filter funnel toggle (the SAME affordance categorical sections get)
  // that reveals and auto-focuses the input. Previously attribute sections
  // showed an inline input only once the key count crossed a threshold and had
  // no header icon, so a short list had no filter affordance and read as broken
  // next to the categorical sections (#18a).
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  // Reset the query when the search closes so reopening doesn't surprise the
  // user with a stale filter from a previous interaction.
  useEffect(() => {
    if (!searchOpen) setSearchQuery("");
  }, [searchOpen]);

  // Keys sorted by count desc — the cap below trims the tail of this list.
  const sorted = useMemo(
    () => [...keys].sort((a, b) => b.count - a.count),
    [keys],
  );

  const searchActive = searchQuery.trim().length > 0;
  const filtered = useMemo(() => {
    if (!searchActive) return sorted;
    const q = searchQuery.toLowerCase();
    // Match the displayed (stripped) label so typing "env" finds
    // "environment" even though the underlying key is "metadata.environment".
    // Searches the FULL set — the cap only ever applies to the unfiltered list.
    return sorted.filter((k) =>
      stripPrefix(k.value, displayStripPrefix).toLowerCase().includes(q),
    );
  }, [sorted, searchActive, searchQuery, displayStripPrefix]);

  // Cap the unfiltered list at the top N keys (by count); the "Show N more"
  // expander reveals the rest. A search bypasses the cap and shows all matches.
  const [showAll, setShowAll] = useState(false);
  const isCapped =
    !searchActive && filtered.length > MAX_VISIBLE_ATTRIBUTE_KEYS;
  const visible =
    isCapped && !showAll
      ? filtered.slice(0, MAX_VISIBLE_ATTRIBUTE_KEYS)
      : filtered;
  const hiddenCount = filtered.length - MAX_VISIBLE_ATTRIBUTE_KEYS;

  return (
    <SidebarSection
      title={title}
      icon={icon}
      valueCount={keys.length}
      dragHandleProps={dragHandleProps}
      onShiftToggle={onShiftToggle}
      onHide={onHide}
      hideLabel={`Hide ${title}`}
      searchToggleProps={
        keys.length > 0
          ? {
              open: searchOpen,
              onToggle: () => setSearchOpen((prev) => !prev),
            }
          : undefined
      }
    >
      <VStack gap={0.5} align="stretch">
        {keys.length === 0 && emptyDocsHref ? (
          // Always-visible facets (Metadata) keep their slot when nothing has
          // been discovered yet, pointing the user at how to start emitting
          // these attributes instead of dead-ending on a blank section.
          <VStack gap={1} align="start" paddingX={1.5} paddingY={1.5}>
            <Text textStyle="2xs" color="fg.subtle">
              No metadata on these traces yet.
            </Text>
            <Link
              href={emptyDocsHref}
              target="_blank"
              rel="noopener noreferrer"
              textStyle="2xs"
              fontWeight="medium"
              color="blue.fg"
            >
              Learn how to add metadata →
            </Link>
          </VStack>
        ) : (
          <>
            {searchOpen && (
              // Inset the input (paddingX/paddingY) so its 2px focus ring has
              // room — without the gutter the ring's edges were clipped by the
              // sidebar scroll container's overflow. The Input itself also uses
              // an inset focus ring (outlineOffset -2px) as a belt-and-braces
              // guard (#18b).
              <VStack gap={0.5} align="stretch" paddingX={0.5} paddingY={0.5}>
                <Input
                  ref={searchInputRef}
                  size="xs"
                  placeholder="Filter keys..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  textStyle="xs"
                  _focusVisible={{
                    outlineWidth: "2px",
                    outlineStyle: "solid",
                    outlineColor: "blue.focusRing",
                    outlineOffset: "-2px",
                  }}
                />
              </VStack>
            )}
            {visible.map((key) => (
              <AttributeKeyRow
                key={key.value}
                attrKey={key.value}
                displayLabel={stripPrefix(key.value, displayStripPrefix)}
                count={key.count}
                getValueState={getValueState}
                noneActive={getNoneActive(key.value)}
                onToggleValue={onToggleValue}
                onToggleNone={() => onToggleNone(key.value)}
              />
            ))}
            {filtered.length === 0 && (
              <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
                No matching keys
              </Text>
            )}
            {isCapped && (
              <Button
                variant="plain"
                size="xs"
                justifyContent="flex-start"
                width="fit-content"
                color="fg.subtle"
                paddingX={1}
                paddingY={1}
                height="auto"
                _hover={{ color: "fg", textDecoration: "underline" }}
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll ? "Show less" : `Show ${hiddenCount} more`}
              </Button>
            )}
          </>
        )}
      </VStack>
    </SidebarSection>
  );
};

export const AttributesSection = memo(AttributesSectionInner);
