import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Circle,
  Flex,
  HStack,
  Icon,
  Input,
  Text,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LuArrowDown, LuArrowUp, LuSearch, LuX } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import {
  SPAN_TYPE_COLORS,
  STATUS_COLORS,
  formatDuration,
  truncateId,
} from "../../utils/formatters";

interface SpanListViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  initialSearch?: string;
  initialTypeFilter?: string;
}

type SortField =
  | "name"
  | "type"
  | "duration"
  | "model"
  | "status"
  | "start";
type SortDirection = "asc" | "desc";

interface DerivedSpan {
  span: SpanTreeNode;
  duration: number;
  startOffset: number;
}

const ROW_HEIGHT = 32;

// Cost + Tokens previously had columns here but the span tree payload
// never carries those numbers (they live on the heavier per-span detail
// query), so the cells were always empty dashes — pure noise. We drop
// them; the per-span drawer surfaces tokens/cost when you select a row.
const COLUMNS: {
  field: SortField;
  label: string;
  width: string;
  flex?: number;
  align?: "left" | "right" | "center";
  mono?: boolean;
}[] = [
  { field: "name", label: "Name", width: "auto", flex: 1, mono: true },
  { field: "type", label: "Type", width: "72px" },
  { field: "duration", label: "Duration", width: "76px", align: "right", mono: true },
  { field: "model", label: "Model", width: "100px" },
  { field: "status", label: "", width: "32px", align: "center" },
  { field: "start", label: "Start", width: "72px", align: "right", mono: true },
];

function deriveSpan(span: SpanTreeNode, rootStart: number): DerivedSpan {
  return {
    span,
    duration: span.durationMs,
    startOffset: span.startTimeMs - rootStart,
  };
}

function formatOffset(ms: number): string {
  if (ms === 0) return "+0ms";
  if (ms < 1_000) return `+${Math.round(ms)}ms`;
  return `+${(ms / 1_000).toFixed(1)}s`;
}

function compareDerived(
  a: DerivedSpan,
  b: DerivedSpan,
  field: SortField,
  direction: SortDirection,
): number {
  const mul = direction === "asc" ? 1 : -1;
  switch (field) {
    case "name":
      return mul * a.span.name.localeCompare(b.span.name);
    case "type":
      return (
        mul *
        (a.span.type ?? "span").localeCompare(b.span.type ?? "span")
      );
    case "duration":
      return mul * (a.duration - b.duration);
    case "model":
      return (
        mul * (a.span.model ?? "").localeCompare(b.span.model ?? "")
      );
    case "status": {
      const sa = a.span.status === "error" ? 0 : 1;
      const sb = b.span.status === "error" ? 0 : 1;
      return mul * (sa - sb);
    }
    case "start":
      return mul * (a.startOffset - b.startOffset);
    default:
      return 0;
  }
}

export function SpanListView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
  initialSearch = "",
  initialTypeFilter,
}: SpanListViewProps) {
  const [sortField, setSortField] = useState<SortField>("duration");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    initialTypeFilter ? new Set([initialTypeFilter]) : new Set(),
  );

  // Sync from props when cross-view navigation triggers a filter update
  useEffect(() => {
    if (initialSearch) setSearchQuery(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    if (initialTypeFilter) {
      setActiveTypes(new Set([initialTypeFilter]));
    }
  }, [initialTypeFilter]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rootStart = useMemo(() => {
    if (spans.length === 0) return 0;
    return Math.min(...spans.map((s) => s.startTimeMs));
  }, [spans]);

  const allDerived = useMemo(
    () => spans.map((s) => deriveSpan(s, rootStart)),
    [spans, rootStart],
  );

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of spans) {
      const t = s.type ?? "span";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [spans]);

  const allTypes = useMemo(
    () => Array.from(typeCounts.keys()).sort(),
    [typeCounts],
  );

  const isTypeFiltered = activeTypes.size > 0;
  const isSingleTypeFiltered = activeTypes.size === 1;

  const filteredDerived = useMemo(() => {
    let result = allDerived;
    if (isTypeFiltered) {
      result = result.filter((d) =>
        activeTypes.has(d.span.type ?? "span"),
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((d) =>
        d.span.name.toLowerCase().includes(q),
      );
    }
    return result;
  }, [allDerived, activeTypes, isTypeFiltered, searchQuery]);

  const sortedDerived = useMemo(() => {
    const sorted = [...filteredDerived].sort((a, b) => {
      const primary = compareDerived(a, b, sortField, sortDirection);
      if (primary !== 0) return primary;
      // Secondary sort by start time ascending
      return a.startOffset - b.startOffset;
    });
    return sorted;
  }, [filteredDerived, sortField, sortDirection]);

  const isFiltered = isTypeFiltered || searchQuery.trim().length > 0;

  const totals = useMemo(() => {
    const source = isFiltered ? filteredDerived : allDerived;
    const rootSpan = allDerived.find((d) => d.span.parentSpanId === null);
    const traceDuration = rootSpan
      ? rootSpan.duration
      : allDerived.length > 0
        ? Math.max(...allDerived.map((d) => d.span.startTimeMs + d.span.durationMs)) - rootStart
        : 0;

    return {
      duration: isFiltered && source.length > 0
        ? Math.max(...source.map((d) => d.span.startTimeMs + d.span.durationMs)) -
          Math.min(...source.map((d) => d.span.startTimeMs))
        : traceDuration,
    };
  }, [allDerived, filteredDerived, isFiltered, rootStart]);

  // Virtualization
  const virtualizer = useVirtualizer({
    count: sortedDerived.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Visible columns (hide type when filtered to single type)
  const visibleColumns = useMemo(
    () =>
      COLUMNS.filter((col) => {
        if (col.field === "type" && isSingleTypeFiltered) return false;
        return true;
      }),
    [isSingleTypeFiltered],
  );

  function handleHeaderClick(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  }

  function handleRowClick(spanId: string) {
    if (spanId === selectedSpanId) {
      onClearSpan();
    } else {
      onSelectSpan(spanId);
    }
  }

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function clearAllFilters() {
    setActiveTypes(new Set());
    setSearchQuery("");
  }

  return (
    <Flex direction="column" height="full" overflow="hidden">
      {/* Filter bar */}
      <Flex
        direction="column"
        gap={2}
        paddingX={3}
        paddingY={2}
        flexShrink={0}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/30"
      >
        <Flex gap={2} align="center">
          {/* Search input */}
          <Flex
            flex={1}
            align="center"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            paddingX={2}
            height="28px"
            bg="bg.panel"
            _focusWithin={{ borderColor: "blue.solid", boxShadow: "0 0 0 1px var(--chakra-colors-blue-solid)" }}
            transition="all 0.15s ease"
          >
            <Icon as={LuSearch} boxSize={3} color="fg.subtle" flexShrink={0} />
            <Input
              size="xs"
              variant="flushed"
              placeholder="Filter spans..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              paddingX={1.5}
              height="full"
              textStyle="xs"
              borderWidth={0}
              _focus={{ boxShadow: "none" }}
            />
            {searchQuery && (
              <Flex
                as="button"
                align="center"
                justify="center"
                cursor="pointer"
                onClick={() => setSearchQuery("")}
                color="fg.subtle"
                _hover={{ color: "fg" }}
                flexShrink={0}
              >
                <Icon as={LuX} boxSize={3} />
              </Flex>
            )}
          </Flex>

          {/* Span count */}
          <Text textStyle="xs" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
            {filteredDerived.length === spans.length
              ? `${spans.length} spans`
              : `${filteredDerived.length} of ${spans.length} spans`}
          </Text>
        </Flex>

        {/* Type filter chips */}
        <HStack gap={1} flexWrap="wrap">
          <FilterChip
            label="All"
            count={spans.length}
            isActive={!isTypeFiltered}
            onClick={() => setActiveTypes(new Set())}
          />
          {allTypes.map((type) => {
            const count = typeCounts.get(type) ?? 0;
            return (
              <FilterChip
                key={type}
                label={type.toUpperCase()}
                count={count}
                isActive={activeTypes.has(type)}
                isDisabled={count === 0}
                color={(SPAN_TYPE_COLORS[type] as string) ?? "gray.solid"}
                onClick={() => toggleType(type)}
              />
            );
          })}
        </HStack>
      </Flex>

      {/* Table header */}
      <Flex
        gap={0}
        paddingX={3}
        paddingY={1}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        flexShrink={0}
      >
        {visibleColumns.map((col) => (
          <Flex
            key={col.field}
            flex={col.flex ?? "none"}
            width={col.flex ? undefined : col.width}
            paddingX={1}
            cursor="pointer"
            onClick={() => handleHeaderClick(col.field)}
            userSelect="none"
            align="center"
            justify={
              col.align === "right"
                ? "flex-end"
                : col.align === "center"
                  ? "center"
                  : "flex-start"
            }
            _hover={{ color: "fg" }}
            transition="color 0.1s ease"
          >
            <Text
              textStyle="xs"
              fontWeight="semibold"
              color={sortField === col.field ? "fg" : "fg.muted"}
            >
              {col.label}
            </Text>
            {sortField === col.field && (
              <Icon
                as={sortDirection === "asc" ? LuArrowUp : LuArrowDown}
                boxSize={3}
                color="fg.muted"
                marginLeft={0.5}
              />
            )}
          </Flex>
        ))}
      </Flex>

      {/* Virtualized rows */}
      <Box
        ref={scrollContainerRef}
        flex={1}
        overflow="auto"
        css={{
          "&::-webkit-scrollbar": { width: "4px" },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: "4px",
            background: "var(--chakra-colors-border-muted)",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        {sortedDerived.length === 0 ? (
          <Flex direction="column" align="center" justify="center" paddingY={8} gap={2}>
            <Text textStyle="xs" color="fg.subtle">
              No spans match the current filter
            </Text>
            <Flex
              as="button"
              cursor="pointer"
              paddingX={2}
              paddingY={1}
              borderRadius="md"
              bg="bg.muted"
              _hover={{ bg: "bg.emphasized" }}
              onClick={clearAllFilters}
            >
              <Text textStyle="xs" color="blue.fg">
                Clear filters
              </Text>
            </Flex>
          </Flex>
        ) : (
          <Box
            position="relative"
            height={`${virtualizer.getTotalSize()}px`}
            width="full"
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const d = sortedDerived[virtualRow.index]!;
              const isSelected = d.span.spanId === selectedSpanId;

              return (
                <Tooltip
                  key={d.span.spanId}
                  content={`Span ID: ${truncateId(d.span.spanId, 16)}`}
                  positioning={{ placement: "left" }}
                >
                  <Flex
                    position="absolute"
                    top={0}
                    left={0}
                    width="full"
                    height={`${virtualRow.size}px`}
                    transform={`translateY(${virtualRow.start}px)`}
                    gap={0}
                    paddingX={3}
                    paddingY={0}
                    align="center"
                    cursor="pointer"
                    bg={isSelected ? "blue.subtle" : undefined}
                    borderLeftWidth={isSelected ? "2px" : "0px"}
                    borderLeftColor={isSelected ? "blue.solid" : "transparent"}
                    _hover={{ bg: isSelected ? "blue.subtle" : "bg.muted" }}
                    onClick={() => handleRowClick(d.span.spanId)}
                    transition="background 0.1s ease"
                    borderBottomWidth="1px"
                    borderBottomColor="border.subtle"
                  >
                    {visibleColumns.map((col) => (
                      <Box
                        key={col.field}
                        flex={col.flex ?? "none"}
                        width={col.flex ? undefined : col.width}
                        paddingX={1}
                        minWidth={0}
                        display="flex"
                        alignItems="center"
                        justifyContent={
                          col.align === "right"
                            ? "flex-end"
                            : col.align === "center"
                              ? "center"
                              : "flex-start"
                        }
                      >
                        <CellContent col={col.field} data={d} />
                      </Box>
                    ))}
                  </Flex>
                </Tooltip>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Footer totals */}
      {sortedDerived.length > 0 && (
        <Flex
          gap={0}
          paddingX={3}
          paddingY={1.5}
          borderTopWidth="1px"
          borderColor="border.subtle"
          flexShrink={0}
          bg="bg.subtle/30"
        >
          {visibleColumns.map((col) => (
            <Box
              key={col.field}
              flex={col.flex ?? "none"}
              width={col.flex ? undefined : col.width}
              paddingX={1}
              display="flex"
              alignItems="center"
              justifyContent={
                col.align === "right"
                  ? "flex-end"
                  : col.align === "center"
                    ? "center"
                    : "flex-start"
              }
            >
              <FooterCell field={col.field} totals={totals} isFiltered={isFiltered} />
            </Box>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function CellContent({
  col,
  data,
}: {
  col: SortField;
  data: DerivedSpan;
}) {
  switch (col) {
    case "name":
      return (
        <Text
          textStyle="xs"
          fontFamily="mono"
          truncate
          title={data.span.name}
          color="fg"
        >
          {data.span.name}
        </Text>
      );
    case "type":
      return <SpanTypeBadge type={data.span.type ?? "span"} />;
    case "duration":
      return (
        <Text textStyle="xs" fontFamily="mono" color="fg.muted">
          {data.duration === 0 ? "<1ms" : formatDuration(data.duration)}
        </Text>
      );
    case "model":
      return (
        <Text
          textStyle="xs"
          truncate
          color="fg.muted"
          title={data.span.model ?? undefined}
        >
          {data.span.model ? data.span.model.split("/").pop() : "\u2014"}
        </Text>
      );
    case "status": {
      const statusColor =
        (STATUS_COLORS[data.span.status] as string) ?? "gray.solid";
      return (
        <Tooltip
          content={data.span.status.toUpperCase()}
          positioning={{ placement: "top" }}
        >
          <Circle size="8px" bg={statusColor} />
        </Tooltip>
      );
    }
    case "start":
      return (
        <Text textStyle="xs" fontFamily="mono" color="fg.subtle">
          {formatOffset(data.startOffset)}
        </Text>
      );
    default:
      return null;
  }
}

function FooterCell({
  field,
  totals,
  isFiltered,
}: {
  field: SortField;
  totals: {
    duration: number;
  };
  isFiltered: boolean;
}) {
  switch (field) {
    case "name":
      return (
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
          {isFiltered ? "Filtered totals:" : "Totals:"}
        </Text>
      );
    case "duration":
      return (
        <Tooltip
          content={isFiltered ? "Sum of filtered spans" : "Trace duration"}
          positioning={{ placement: "top" }}
        >
          <Text textStyle="xs" fontWeight="semibold" fontFamily="mono" color="fg.muted">
            {totals.duration === 0
              ? "<1ms"
              : formatDuration(totals.duration)}
            {!isFiltered && "*"}
          </Text>
        </Tooltip>
      );
    default:
      return null;
  }
}

function SpanTypeBadge({ type }: { type: string }) {
  const color = (SPAN_TYPE_COLORS[type] as string) ?? "gray.solid";
  const label = type.length <= 5 ? type.toUpperCase() : type.slice(0, 5).toUpperCase();

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      bg="bg.muted"
      borderRadius="sm"
      paddingX={1.5}
      paddingY={0.5}
      borderWidth="1px"
      borderColor="border.subtle"
    >
      <Text textStyle="xs" fontWeight="semibold" color={color} lineHeight={1}>
        {label}
      </Text>
    </Box>
  );
}

function FilterChip({
  label,
  count,
  isActive,
  isDisabled,
  onClick,
  color,
}: {
  label: string;
  count: number;
  isActive: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <Flex
      as="button"
      align="center"
      gap={1}
      paddingX={2}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isActive ? (color ?? "border.emphasized") : "border.subtle"}
      bg={isActive ? "bg.emphasized" : "transparent"}
      cursor={isDisabled ? "default" : "pointer"}
      opacity={isDisabled ? 0.4 : 1}
      onClick={isDisabled ? undefined : onClick}
      _hover={
        isDisabled
          ? undefined
          : { bg: isActive ? "bg.emphasized" : "bg.muted" }
      }
      transition="all 0.15s ease"
    >
      {color && (
        <Circle size="6px" bg={color} />
      )}
      <Text
        textStyle="xs"
        color={isActive ? "fg" : "fg.muted"}
        fontWeight={isActive ? "medium" : "normal"}
        lineHeight={1}
      >
        {label}
      </Text>
      <Text textStyle="xs" color="fg.subtle" lineHeight={1}>
        {count}
      </Text>
    </Flex>
  );
}
