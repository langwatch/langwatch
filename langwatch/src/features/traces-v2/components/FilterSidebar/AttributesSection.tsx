// eslint-disable-next-line no-restricted-imports
import {
  Badge,
  Box,
  chakra,
  Collapsible,
  HStack,
  Icon,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { memo, useMemo, useState } from "react";
import { useAttributeValues } from "../../hooks/useAttributeValues";
import { hashColor } from "../../utils/formatters";
import { SidebarSection } from "./SidebarSection";

const RowButton = chakra("button");

interface AttributeKey {
  value: string;
  count: number;
}

interface AttributesSectionProps {
  keys: AttributeKey[];
  /** Active filter state per `attribute.<key>:<value>` */
  getValueState: (attrKey: string, value: string) => "include" | "exclude" | "neutral";
  /** Active state for `none:attribute.<key>` */
  getNoneActive: (attrKey: string) => boolean;
  onToggleValue: (attrKey: string, value: string) => void;
  onToggleNone: (attrKey: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * Top-K most common attribute keys whose values get prefetched on mount, so the
 * first expand reads from cache instead of waiting for ClickHouse. Stale-while-
 * revalidate on the backend keeps these warm for repeat visits.
 */
const PREFETCH_TOP_KEYS = 8;

export const AttributesSection: React.FC<AttributesSectionProps> = ({
  keys,
  getValueState,
  getNoneActive,
  onToggleValue,
  onToggleNone,
  dragHandleProps,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const sorted = useMemo(
    () => [...keys].sort((a, b) => b.count - a.count),
    [keys],
  );

  const filtered = useMemo(() => {
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((k) => k.value.toLowerCase().includes(q));
  }, [sorted, searchQuery]);

  return (
    <SidebarSection
      title="Attributes"
      valueCount={keys.length}
      dragHandleProps={dragHandleProps}
    >
      <VStack gap={0.5} align="stretch">
        {keys.length >= 5 && (
          <Input
            size="xs"
            placeholder="Filter keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            marginBottom={1}
            textStyle="xs"
          />
        )}
        {filtered.map((key, idx) => (
          <AttributeKeyRow
            key={key.value}
            attrKey={key.value}
            count={key.count}
            prefetch={idx < PREFETCH_TOP_KEYS && !searchQuery}
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
      </VStack>
    </SidebarSection>
  );
};

const AttributeKeyRow = memo(function AttributeKeyRow({
  attrKey,
  count,
  prefetch,
  getValueState,
  noneActive,
  onToggleValue,
  onToggleNone,
}: {
  attrKey: string;
  count: number;
  prefetch: boolean;
  getValueState: (attrKey: string, value: string) => "include" | "exclude" | "neutral";
  noneActive: boolean;
  onToggleValue: (attrKey: string, value: string) => void;
  onToggleNone: () => void;
}) {
  const [open, setOpen] = useState(false);
  // `prefetch` warms the cache on mount (top-N keys) so the user's first
  // expand is instant. Once expanded, normal lazy loading takes over.
  const { values, isLoading } = useAttributeValues(attrKey, open || prefetch);

  const activeCount = useMemo(() => {
    const valueActive = values.filter(
      (v) => getValueState(attrKey, v.value) !== "neutral",
    ).length;
    return valueActive + (noneActive ? 1 : 0);
  }, [values, attrKey, getValueState, noneActive]);

  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <RowButton
          type="button"
          width="full"
          paddingY={1}
          paddingX={1.5}
          cursor="pointer"
          textAlign="left"
          background="transparent"
          border="none"
          borderRadius="sm"
          _hover={{ "& [data-attr-label]": { color: "var(--chakra-colors-fg)" } }}
        >
          <HStack gap={1.5} minWidth={0}>
            <Icon color="fg.subtle" boxSize="10px">
              {open ? <ChevronDown /> : <ChevronRight />}
            </Icon>
            <Text
              textStyle="xs"
              fontFamily="mono"
              fontWeight={activeCount > 0 ? "500" : "400"}
              truncate
              flex={1}
              minWidth={0}
              data-attr-label
              color={activeCount > 0 ? "fg" : "fg.muted"}
            >
              {attrKey}
            </Text>
            {activeCount > 0 && (
              <Badge variant="solid" size="xs" colorPalette="blue" borderRadius="full">
                {activeCount}
              </Badge>
            )}
            <Text
              textStyle="xs"
              color="fg.subtle"
              fontFamily="mono"
              flexShrink={0}
            >
              {formatCount(count)}
            </Text>
          </HStack>
        </RowButton>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <VStack gap={0.5} align="stretch" paddingLeft={3} marginTop={0.5}>
          {isLoading && (
            <HStack paddingX={1} paddingY={1}>
              <Spinner size="xs" />
              <Text textStyle="2xs" color="fg.subtle">
                Loading…
              </Text>
            </HStack>
          )}
          {!isLoading && values.length === 0 && (
            <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
              No values
            </Text>
          )}
          {values.map((v) => {
            const state = getValueState(attrKey, v.value);
            return (
              <AttributeValueRow
                key={v.value}
                attrKey={attrKey}
                value={v.value}
                label={v.label ?? v.value}
                state={state}
                onToggle={onToggleValue}
              />
            );
          })}
          <NoneAttributeRow active={noneActive} onToggle={onToggleNone} />
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
});

const AttributeValueRow = memo(function AttributeValueRow({
  attrKey,
  value,
  label,
  state,
  onToggle,
}: {
  attrKey: string;
  value: string;
  label: string;
  state: "include" | "exclude" | "neutral";
  onToggle: (attrKey: string, value: string) => void;
}) {
  const isInclude = state === "include";
  const isExclude = state === "exclude";

  // No counts for attribute values (we skip them in the backend for speed),
  // so the bar is a flat tint that just signals selection state.
  const palette = paletteFromColor(hashColor(value));
  const barBg = isExclude
    ? "red.muted"
    : isInclude
      ? `${palette}.muted`
      : "transparent";

  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={isInclude ? true : isExclude ? "mixed" : false}
      position="relative"
      width="full"
      paddingY={1}
      paddingX={1.5}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background="transparent"
      border="none"
      onClick={() => onToggle(attrKey, value)}
      _hover={{
        "& [data-facet-label]": {
          color: "var(--chakra-colors-fg)",
          fontWeight: 500,
        },
        "& [data-facet-bar]": {
          background:
            state === "neutral"
              ? `var(--chakra-colors-${palette}-subtle)`
              : isExclude
                ? "var(--chakra-colors-red-emphasized)"
                : `var(--chakra-colors-${palette}-emphasized)`,
        },
      }}
    >
      <Box
        data-facet-bar
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width="100%"
        bg={barBg}
        pointerEvents="none"
        transition="background 120ms ease"
      />
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Text
          textStyle="xs"
          fontWeight={state === "neutral" ? "400" : "500"}
          truncate
          flex={1}
          minWidth={0}
          data-facet-label
          color={state === "neutral" ? "fg.muted" : "fg"}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {label}
        </Text>
      </HStack>
    </RowButton>
  );
});

const NoneAttributeRow: React.FC<{ active: boolean; onToggle: () => void }> = ({
  active,
  onToggle,
}) => (
  <RowButton
    type="button"
    role="checkbox"
    aria-checked={active}
    position="relative"
    width="full"
    paddingY={1}
    paddingX={1.5}
    cursor="pointer"
    textAlign="left"
    borderRadius="sm"
    overflow="hidden"
    background={active ? "gray.muted" : "transparent"}
    border="none"
    onClick={onToggle}
    _hover={{ background: active ? "gray.emphasized" : "gray.subtle" }}
  >
    <HStack gap={1.5} minWidth={0}>
      <Text
        textStyle="xs"
        fontStyle="italic"
        fontWeight={active ? "500" : "400"}
        color={active ? "fg" : "fg.subtle"}
      >
        (none)
      </Text>
    </HStack>
  </RowButton>
);

function paletteFromColor(color: string | undefined): string {
  if (typeof color !== "string") return "gray";
  const idx = color.indexOf(".");
  return idx === -1 ? color : color.slice(0, idx);
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
