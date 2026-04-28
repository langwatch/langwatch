import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuBraces,
  LuCopy,
  LuExternalLink,
  LuKeyboard,
  LuMaximize2,
  LuMinimize2,
  LuRefreshCw,
  LuScanSearch,
  LuShare2,
  LuX,
} from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { usePinnedAttributes } from "../../../hooks/usePinnedAttributes";
import { useThreadContext } from "../../../hooks/useThreadContext";
import { useTraceRefresh } from "../../../hooks/useTraceRefresh";
import { useTraceResources } from "../../../hooks/useTraceResources";
import type { DrawerViewMode } from "../../../stores/drawerStore";
import { useFilterStore } from "../../../stores/filterStore";
import type { PinnedAttribute } from "../../../stores/pinnedAttributesStore";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  SPAN_TYPE_COLORS,
  STATUS_COLORS,
} from "../../../utils/formatters";
import { ModeSwitch } from "../ModeSwitch";
import { RawJsonDialog } from "../RawJsonDialog";
import { TraceHeaderChips } from "../TraceHeaderChips";
import { MetricPill, PinnedMetricPill } from "./MetricPill";
import { ThreadProgressIndicator } from "./ThreadProgressIndicator";
import { TooltipRow } from "./TooltipRow";
import { TraceActionsMenu } from "./TraceActionsMenu";
import { readNumberAttribute, resolveAttributeValue } from "./utils";

interface DrawerHeaderProps {
  trace: TraceHeader;
  isMaximized: boolean;
  /**
   * Threaded down to the chip bar so the latest-prompt chip can deep-link
   * to its source span via the same path as visualization clicks.
   */
  onSelectSpan: (spanId: string) => void;
  /** Switches the lower tab bar to the Prompts panel. */
  onOpenPromptsTab: () => void;
  viewMode: DrawerViewMode;
  onViewModeChange: (mode: DrawerViewMode) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  onShowShortcuts: () => void;
  canGoBack: boolean;
  onGoBack: () => void;
  backStackDepth: number;
  /**
   * True while the trace header query is fetching (initial load or refetch
   * after thread navigation). Drives the inline spinner in the thread
   * progress indicator so the user knows J/K is doing something.
   */
  isNavigating?: boolean;
}

interface DisplayedPin {
  pin: PinnedAttribute;
  auto: boolean;
}

/**
 * Curated hoisted attribute keys we know are valuable enough to surface
 * in the pinned strip whenever they're present on a trace. The user can
 * still pin/unpin their own — auto-pins just bootstrap the strip so it
 * isn't empty out of the box.
 */
/**
 * Pin attribute keys that map to a filter-store facet field. When a pinned
 * attribute is one of these, the pill shows a filter icon that scopes the
 * trace table to this attribute's value.
 */
const FILTERABLE_PIN_FIELDS: Record<string, string> = {
  "gen_ai.conversation.id": "conversation",
  "langwatch.thread_id": "conversation",
  "langwatch.user_id": "user",
};

const HOISTED_AUTO_PINS: Array<{ key: string; label: string }> = [
  { key: "scenario.run_id", label: "Scenario run" },
  { key: "evaluation.run_id", label: "Eval run" },
  { key: "gen_ai.conversation.id", label: "Conversation" },
  { key: "langwatch.thread_id", label: "Thread" },
  { key: "langwatch.user_id", label: "User" },
  { key: "langwatch.labels", label: "Labels" },
];

export function DrawerHeader({
  trace,
  isMaximized,
  onSelectSpan,
  onOpenPromptsTab,
  viewMode,
  onViewModeChange,
  onToggleMaximized,
  onClose,
  onShowShortcuts,
  canGoBack,
  onGoBack,
  backStackDepth,
  isNavigating = false,
}: DrawerHeaderProps) {
  const statusColor = STATUS_COLORS[trace.status] as string;
  const { project } = useOrganizationTeamProject();
  const dejaView = useDejaViewLink({
    aggregateId: trace.traceId,
    tenantId: project?.id,
  });

  const cacheReadTokens = readNumberAttribute(
    trace.attributes,
    "gen_ai.usage.cache_read.input_tokens",
    "gen_ai.usage.cached_tokens",
  );
  const cacheCreationTokens = readNumberAttribute(
    trace.attributes,
    "gen_ai.usage.cache_creation.input_tokens",
  );

  // If we have concrete input AND output token numbers to display, trust them
  // and suppress the "estimated" caveat — historical trace summaries can carry
  // a stale `tokensEstimated=true` from before the per-span fix landed, so
  // gating on actual presence here keeps the popover honest without a backfill.
  const hasAuthoritativeTokens =
    trace.inputTokens != null &&
    trace.outputTokens != null &&
    (trace.inputTokens > 0 || trace.outputTokens > 0);

  const resources = useTraceResources(trace.traceId);
  const threadContext = useThreadContext(
    trace.conversationId ?? null,
    trace.traceId,
  );
  const { pins, removePin } = usePinnedAttributes(project?.id);
  // Render hoisted attributes that are present on this trace as auto-pins
  // so users see them out of the gate. They sit before user pins and are
  // skipped if the user has already pinned them explicitly.
  const allPins = useMemo<DisplayedPin[]>(() => {
    const userKeys = new Set(pins.map((p) => `${p.source}:${p.key}`));
    const auto: DisplayedPin[] = [];
    for (const def of HOISTED_AUTO_PINS) {
      if (userKeys.has(`attribute:${def.key}`)) continue;
      const value = trace.attributes[def.key];
      if (!value) continue;
      auto.push({
        pin: { source: "attribute", key: def.key, label: def.label },
        auto: true,
      });
    }
    return [
      ...auto,
      ...pins.map<DisplayedPin>((p) => ({ pin: p, auto: false })),
    ];
  }, [pins, trace.attributes]);

  const handleCopyTraceId = () => {
    void navigator.clipboard.writeText(trace.traceId);
  };

  const [rawOpen, setRawOpen] = useState(false);

  // Local listener for the `\` shortcut. Lives here (rather than in
  // TraceDrawerShell) because the raw-JSON dialog's open state is also
  // local — keeping both colocated avoids lifting state purely for the
  // sake of a single shortcut.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "\\") {
        e.preventDefault();
        setRawOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const { closeDrawer } = useDrawer();
  // Build a query string from the highest-signal axes available on this trace.
  // Service + status are usually present; root span name is a strong cluster
  // signal. We quote bare strings to keep liqe happy with spaces/dashes.
  const findSimilarQuery = useMemo(() => {
    const parts: string[] = [];
    if (trace.serviceName) parts.push(`service:"${trace.serviceName}"`);
    if (trace.status === "error") parts.push("status:error");
    if (trace.rootSpanName) {
      parts.push(`"${trace.rootSpanName.replace(/"/g, '\\"')}"`);
    }
    return parts.join(" ");
  }, [trace.serviceName, trace.status, trace.rootSpanName]);
  const handleFindSimilar = useCallback(() => {
    if (!findSimilarQuery) return;
    applyQueryText(findSimilarQuery);
    closeDrawer();
  }, [applyQueryText, closeDrawer, findSimilarQuery]);

  const { refresh: handleRefresh, isRefreshing } = useTraceRefresh(
    trace.traceId,
  );

  return (
    <VStack align="stretch" gap={2} paddingX={4} paddingY={3}>
      {/* Row 1: Trace ID + Actions */}
      <HStack justify="space-between" align="center">
        <HStack gap={1} minWidth={0}>
          {canGoBack && (
            <Tooltip
              content={
                <HStack gap={1}>
                  <Text>
                    {backStackDepth > 1
                      ? `Back (${backStackDepth} traces)`
                      : "Back to previous trace"}
                  </Text>
                  <Kbd>B</Kbd>
                </HStack>
              }
              positioning={{ placement: "bottom" }}
            >
              <Button
                size="xs"
                variant="ghost"
                onClick={onGoBack}
                aria-label="Back to previous trace"
                flexShrink={0}
              >
                <Icon as={LuArrowLeft} boxSize={3.5} />
              </Button>
            </Tooltip>
          )}
          <Text
            textStyle="2xs"
            color="fg.subtle"
            fontFamily="mono"
            cursor="default"
            truncate
            letterSpacing="0.02em"
          >
            <Text as="span" color="fg.muted" opacity={0.7}>
              trace
            </Text>{" "}
            {trace.traceId}
          </Text>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>Copy trace ID</Text>
                <Kbd>Y</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={handleCopyTraceId}
              aria-label="Copy trace ID"
              padding={0}
              minWidth="auto"
              height="auto"
              flexShrink={0}
            >
              <Icon as={LuCopy} boxSize={3} color="fg.subtle" />
            </Button>
          </Tooltip>
        </HStack>

        <HStack gap={1} flexShrink={0}>
          <TracePresenceAvatars traceId={trace.traceId} max={3} size="2xs" />
          {findSimilarQuery && (
            <Tooltip
              content={
                <VStack align="stretch" gap={0.5} maxWidth="280px">
                  <Text textStyle="xs" fontWeight="semibold">
                    Find similar traces
                  </Text>
                  <Text textStyle="2xs" color="fg.muted">
                    Closes the drawer and prefills the search with{" "}
                    <Text as="span" fontFamily="mono">
                      {findSimilarQuery}
                    </Text>
                  </Text>
                </VStack>
              }
              positioning={{ placement: "bottom" }}
            >
              <Button
                size="xs"
                variant="ghost"
                onClick={handleFindSimilar}
                aria-label="Find similar traces"
              >
                <Icon as={LuScanSearch} boxSize={3.5} />
              </Button>
            </Tooltip>
          )}
          <TraceActionsMenu
            traceId={trace.traceId}
            conversationId={trace.conversationId}
          />
          <Tooltip
            content="Sharing is coming soon"
            positioning={{ placement: "bottom" }}
          >
            <Button size="xs" variant="ghost" disabled aria-label="Share trace">
              <Icon as={LuShare2} boxSize={3.5} />
            </Button>
          </Tooltip>
          {dejaView.href && (
            <Tooltip
              content="Open in DejaView"
              positioning={{ placement: "bottom" }}
            >
              <Link
                href={dejaView.href}
                isExternal
                aria-label="Open in DejaView"
              >
                <Button size="xs" variant="ghost">
                  <Icon as={LuExternalLink} boxSize={3.5} />
                </Button>
              </Link>
            </Tooltip>
          )}
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>View raw JSON for trace + spans</Text>
                <Kbd>\</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setRawOpen(true)}
              aria-label="View raw JSON"
            >
              <Icon as={LuBraces} boxSize={3.5} />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>Keyboard shortcuts</Text>
                <Kbd>?</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onShowShortcuts}
              aria-label="Show keyboard shortcuts"
            >
              <Icon as={LuKeyboard} boxSize={3.5} />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>{isRefreshing ? "Refreshing…" : "Refresh"}</Text>
                <Kbd>R</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              aria-label="Refresh trace"
              css={
                isRefreshing
                  ? {
                      "& svg": {
                        animation:
                          "tracesV2DrawerRefreshSpin 0.9s linear infinite",
                      },
                      "@keyframes tracesV2DrawerRefreshSpin": {
                        from: { transform: "rotate(0deg)" },
                        to: { transform: "rotate(360deg)" },
                      },
                    }
                  : undefined
              }
            >
              <Icon as={LuRefreshCw} boxSize={3.5} />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>{isMaximized ? "Restore" : "Maximize"}</Text>
                <Kbd>M</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onToggleMaximized}
              aria-label={isMaximized ? "Restore drawer" : "Maximize drawer"}
            >
              <Icon
                as={isMaximized ? LuMinimize2 : LuMaximize2}
                boxSize={3.5}
              />
            </Button>
          </Tooltip>
          <Box
            width="1px"
            height="16px"
            bg="border.muted"
            marginX={0.5}
            flexShrink={0}
          />
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>Close</Text>
                <Kbd>Esc</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onClose}
              aria-label="Close drawer"
            >
              <Icon as={LuX} boxSize={3.5} />
            </Button>
          </Tooltip>
        </HStack>
      </HStack>

      {/* Row 2: Root span name + type badge + status — primary visual
          anchor of the header. The name reads at md so it dominates the
          metadata above and the metric pills below. */}
      <HStack gap={2.5} minWidth={0} flexWrap="wrap" align="center">
        {trace.rootSpanType && (
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color={
              (SPAN_TYPE_COLORS[trace.rootSpanType] as string) ?? "gray.solid"
            }
            paddingX={1.5}
            paddingY={0.5}
            borderRadius="sm"
            borderWidth="1px"
            borderColor={
              (SPAN_TYPE_COLORS[trace.rootSpanType] as string) ?? "gray.solid"
            }
            letterSpacing="0.04em"
            flexShrink={0}
          >
            {trace.rootSpanType.toUpperCase()}
          </Text>
        )}
        <Text
          fontWeight="semibold"
          textStyle="md"
          truncate
          fontFamily="mono"
          letterSpacing="-0.005em"
        >
          {trace.rootSpanName ?? trace.name}
        </Text>
        <HStack gap={1}>
          <Circle size="8px" bg={statusColor} flexShrink={0} />
          {trace.status !== "ok" && (
            <Text
              textStyle="xs"
              fontWeight="medium"
              color={statusColor}
              textTransform="capitalize"
            >
              {trace.status}
            </Text>
          )}
        </HStack>
        {threadContext.total > 1 && (
          <ThreadProgressIndicator
            position={threadContext.position}
            total={threadContext.total}
            isLoading={isNavigating}
          />
        )}
      </HStack>

      {/* Row 3: Metric pills */}
      <HStack gap={1.5} flexWrap="wrap">
        <MetricPill label="Duration" value={formatDuration(trace.durationMs)} />
        {trace.spanCount > 0 && (
          <MetricPill label="Spans" value={trace.spanCount.toLocaleString()} />
        )}
        {trace.ttft != null && (
          <Tooltip
            content={`Time to First Token: ${formatDuration(trace.ttft)}`}
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill label="TTFT" value={formatDuration(trace.ttft)} />
            </Box>
          </Tooltip>
        )}
        {(trace.totalCost ?? 0) > 0 && (
          <Tooltip
            content={
              <VStack align="stretch" gap={0.5} minWidth="140px">
                <TooltipRow
                  label="Total"
                  value={formatCost(
                    trace.totalCost ?? 0,
                    trace.tokensEstimated,
                  )}
                />
                {trace.tokensEstimated && !hasAuthoritativeTokens && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Cost is estimated from token counts
                  </Text>
                )}
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill
                label="Cost"
                value={formatCost(trace.totalCost ?? 0)}
              />
            </Box>
          </Tooltip>
        )}
        {trace.totalTokens > 0 && (
          <Tooltip
            content={
              <VStack align="stretch" gap={0.5} minWidth="180px">
                <TooltipRow
                  label="Input"
                  value={trace.inputTokens?.toLocaleString() ?? "—"}
                />
                <TooltipRow
                  label="Output"
                  value={trace.outputTokens?.toLocaleString() ?? "—"}
                />
                {cacheReadTokens != null && (
                  <TooltipRow
                    label="Cache read"
                    value={cacheReadTokens.toLocaleString()}
                  />
                )}
                {cacheCreationTokens != null && (
                  <TooltipRow
                    label="Cache write"
                    value={cacheCreationTokens.toLocaleString()}
                  />
                )}
                <Box height="1px" bg="border" marginY={1} />
                <TooltipRow
                  label="Total"
                  value={trace.totalTokens.toLocaleString()}
                />
                {trace.tokensEstimated && !hasAuthoritativeTokens && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Tokens are estimated
                  </Text>
                )}
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill
                label="Tokens"
                value={
                  trace.inputTokens != null && trace.outputTokens != null
                    ? `${formatTokens(trace.inputTokens)} in · ${formatTokens(trace.outputTokens)} out`
                    : trace.totalTokens.toLocaleString()
                }
              />
            </Box>
          </Tooltip>
        )}
        {trace.models.length > 0 && (
          <MetricPill label="Model" value={abbreviateModel(trace.models[0]!)} />
        )}
        {/* Pinned attribute pills sit inline with the metrics — they're
            the same kind of "scannable badge" affordance, just driven by
            user choice + auto-hoist instead of fixed metrics. */}
        {allPins.map(({ pin, auto }) => {
          const valueSource =
            pin.source === "resource"
              ? resources.resourceAttributes
              : trace.attributes;
          const value = resolveAttributeValue(valueSource, pin.key);
          // High-signal identity attributes get a "filter table by this"
          // affordance — clicking the filter icon scopes the trace list
          // to traces sharing this user / conversation / thread.
          const filterField = FILTERABLE_PIN_FIELDS[pin.key];
          const onFilter =
            filterField && value
              ? () => {
                  toggleFacet(filterField, value);
                  closeDrawer();
                }
              : undefined;
          return (
            <PinnedMetricPill
              key={`${pin.source}:${pin.key}`}
              pin={pin}
              value={value}
              auto={auto}
              onUnpin={removePin}
              onFilter={onFilter}
            />
          );
        })}
      </HStack>

      {/* Row 4: Metadata chip strip — adding a new chip (prompt, eval,
          env, …) is a one-line entry in `useTraceHeaderChips` (data) plus
          one switch case in `TraceHeaderChips` (JSX), not a JSX edit
          here. */}
      <TraceHeaderChips
        trace={trace}
        onSelectSpan={onSelectSpan}
        onOpenPromptsTab={onOpenPromptsTab}
        endSlot={
          <Text textStyle="xs" color="fg.subtle">
            {formatRelativeTime(trace.timestamp)}
          </Text>
        }
      />

      {/* Row 5: Inline mode tabs — Trace / Conversation. Scenario is a
          link-out chip in row 4, so it isn't a third tab here. */}
      <Box marginX={-4}>
        <ModeSwitch
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          hasConversation={!!trace.conversationId}
          traceId={trace.traceId}
        />
      </Box>
      <RawJsonDialog
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        trace={trace}
      />
    </VStack>
  );
}
