import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuBraces,
  LuCheck,
  LuCopy,
  LuDatabase,
  LuExternalLink,
  LuKeyboard,
  LuLightbulb,
  LuMaximize2,
  LuMinimize2,
  LuPencil,
  LuPin,
  LuPinOff,
  LuRefreshCw,
  LuScanSearch,
  LuShare2,
  LuSparkles,
  LuX,
} from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import { useAnnotationCommentStore } from "~/hooks/useAnnotationCommentStore";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { usePinnedAttributes } from "../../hooks/usePinnedAttributes";
import { useThreadContext } from "../../hooks/useThreadContext";
import { useTraceRefresh } from "../../hooks/useTraceRefresh";
import { useTraceResources } from "../../hooks/useTraceResources";
import type { DrawerViewMode } from "../../stores/drawerStore";
import { useFilterStore } from "../../stores/filterStore";
import type { PinnedAttribute } from "../../stores/pinnedAttributesStore";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  SPAN_TYPE_COLORS,
  STATUS_COLORS,
} from "../../utils/formatters";
import { ModeSwitch } from "./ModeSwitch";
import { RawJsonDialog } from "./RawJsonDialog";
import { TraceHeaderChips } from "./TraceHeaderChips";

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
const HOISTED_AUTO_PINS: Array<{ key: string; label: string }> = [
  { key: "scenario.run_id", label: "Scenario run" },
  { key: "evaluation.run_id", label: "Eval run" },
  { key: "gen_ai.conversation.id", label: "Conversation" },
  { key: "langwatch.thread_id", label: "Thread" },
  { key: "langwatch.user_id", label: "User" },
  { key: "langwatch.labels", label: "Labels" },
];

function readNumberAttribute(
  attributes: Record<string, string>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const raw = attributes[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

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

  const applyQueryText = useFilterStore((s) => s.applyQueryText);
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
                backStackDepth > 1
                  ? `Back (${backStackDepth} traces)`
                  : "Back to previous trace"
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
            output={trace.output ?? null}
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
            content="View raw JSON for trace + spans"
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
            content={isRefreshing ? "Refreshing…" : "Refresh"}
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
          return (
            <PinnedMetricPill
              key={`${pin.source}:${pin.key}`}
              pin={pin}
              value={value}
              auto={auto}
              onUnpin={removePin}
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

function ThreadProgressIndicator({
  position,
  total,
}: {
  position: number;
  total: number;
}) {
  const safePosition = Math.max(1, Math.min(position, total));
  const percent = total > 0 ? (safePosition / total) * 100 : 0;
  return (
    <Tooltip
      content={
        <HStack gap={1}>
          <Text>Navigate thread</Text>
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
        </HStack>
      }
      positioning={{ placement: "bottom" }}
    >
      <HStack gap={1.5} flexShrink={0} cursor="default">
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {safePosition} / {total}
        </Text>
        <Box
          width="48px"
          height="2px"
          borderRadius="full"
          bg="border.muted"
          overflow="hidden"
        >
          <Box
            width={`${percent}%`}
            height="full"
            bg="blue.solid"
            transition="width 0.18s ease"
          />
        </Box>
      </HStack>
    </Tooltip>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        textAlign="right"
        // Long values (conversation IDs, scenario run IDs) need to wrap
        // inside the tooltip box rather than spilling out of it.
        wordBreak="break-all"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
        overflow="hidden"
        // minWidth={0}
      >
        {value}
      </Text>
    </HStack>
  );
}

function TraceActionsMenu({
  traceId,
  output,
}: {
  traceId: string;
  output: string | null;
}) {
  const setCommentState = useAnnotationCommentStore((s) => s.setCommentState);
  const { openDrawer } = useDrawer();

  const handleAnnotate = useCallback(() => {
    setCommentState({
      traceId,
      action: "new",
      annotationId: undefined,
    });
  }, [setCommentState, traceId]);

  const handleSuggest = useCallback(() => {
    setCommentState({
      traceId,
      action: "new",
      annotationId: undefined,
      expectedOutput: output ?? "",
      expectedOutputAction: "new",
    });
  }, [setCommentState, traceId, output]);

  const handleAddToDataset = useCallback(() => {
    openDrawer("addDatasetRecord", { traceId });
  }, [openDrawer, traceId]);

  return (
    <Menu.Root>
      <Tooltip content="Trace actions" positioning={{ placement: "bottom" }}>
        <Menu.Trigger asChild>
          <Button size="xs" variant="ghost" aria-label="Trace actions">
            <Icon as={MoreHorizontal} boxSize={3.5} />
          </Button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content minWidth="180px">
        <Menu.Item value="annotate" onClick={handleAnnotate}>
          <Icon as={LuPencil} boxSize={3.5} />
          Annotate
        </Menu.Item>
        <Menu.Item value="suggest" onClick={handleSuggest}>
          <Icon as={LuLightbulb} boxSize={3.5} />
          Suggest correction
        </Menu.Item>
        <Menu.Item value="add-to-dataset" onClick={handleAddToDataset}>
          <Icon as={LuDatabase} boxSize={3.5} />
          Add to Dataset
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <HStack
      gap={1.5}
      paddingX={2.5}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
    >
      <Text
        textStyle="2xs"
        color="fg.subtle"
        fontFamily="mono"
        textTransform="uppercase"
        letterSpacing="0.04em"
        fontWeight="medium"
      >
        {label}
      </Text>
      <Text textStyle="xs" color="fg" fontFamily="mono" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}

/**
 * MetricPill-shaped pill for a pinned (or auto-pinned) attribute. Sits
 * inline with Duration/Cost/Tokens so the user sees their pinned attrs
 * exactly where they expect scannable data — not as a separate strip up
 * top.
 */
function PinnedMetricPill({
  pin,
  value,
  auto,
  onUnpin,
}: {
  pin: PinnedAttribute;
  value: string | null;
  auto: boolean;
  onUnpin: (source: PinnedAttribute["source"], key: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const display = value ?? "—";
  const label = pin.label ?? pin.key;

  const handleCopy = useCallback(() => {
    if (value == null) return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [value]);

  const tooltipBody = (
    <VStack align="stretch" gap={0.5} minWidth="180px" maxWidth="320px">
      <TooltipRow
        label={
          auto
            ? "Auto-pinned"
            : pin.source === "resource"
              ? "Resource"
              : "Attribute"
        }
        value={pin.key}
      />
      <TooltipRow label="Value" value={display} />
      <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
        Click value to copy{auto ? "" : " · click pin to unpin"}
      </Text>
    </VStack>
  );

  const fg = auto ? "purple.fg" : "blue.fg";
  const bg = auto ? "purple.500/8" : "blue.500/8";
  const border = auto ? "purple.500/30" : "blue.500/30";

  return (
    <Tooltip content={tooltipBody} positioning={{ placement: "top" }}>
      <HStack
        gap={1.5}
        paddingX={2.5}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor={border}
        bg={bg}
        maxWidth="260px"
        minWidth={0}
        overflow="hidden"
        transition="filter 0.12s ease"
        _hover={{ filter: "brightness(1.05)" }}
      >
        {/* Pin icon — non-auto pins click here to unpin. Auto pins are
            non-removable, so the icon is decorative only. */}
        <Box
          as={auto ? "span" : "button"}
          onClick={
            auto
              ? undefined
              : (e: React.MouseEvent) => {
                  e.stopPropagation();
                  onUnpin(pin.source, pin.key);
                }
          }
          aria-label={auto ? undefined : `Unpin ${pin.key}`}
          cursor={auto ? "default" : "pointer"}
          display="inline-flex"
          alignItems="center"
          flexShrink={0}
        >
          <Icon
            as={auto ? LuSparkles : LuPin}
            boxSize={3}
            color={fg}
            flexShrink={0}
          />
        </Box>
        <Text
          textStyle="2xs"
          color={fg}
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.04em"
          fontWeight="medium"
          truncate
          flexShrink={0}
          maxWidth="100px"
        >
          {label}
        </Text>
        {/* Value: click copies. Doubles as the primary affordance —
            users mostly want the value; unpinning is secondary. */}
        <Box
          as="button"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            handleCopy();
          }}
          aria-label={`Copy ${pin.key}`}
          cursor="pointer"
          display="inline-flex"
          alignItems="center"
          gap={1}
          minWidth={0}
          flex={1}
          overflow="hidden"
        >
          <Text
            textStyle="xs"
            color={value == null ? "fg.subtle" : "fg"}
            fontFamily="mono"
            fontWeight="medium"
            truncate
            minWidth={0}
            flex={1}
          >
            {copied ? "copied" : display}
          </Text>
          <Icon
            as={copied ? LuCheck : LuCopy}
            boxSize={2.5}
            color={fg}
            opacity={copied ? 1 : 0.55}
            transition="opacity 0.12s ease"
            flexShrink={0}
          />
        </Box>
      </HStack>
    </Tooltip>
  );
}

function formatPinValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function resolveAttributeValue(
  source: Record<string, string> | Record<string, unknown>,
  key: string,
): string | null {
  if (key in source) {
    return formatPinValue((source as Record<string, unknown>)[key]);
  }
  // Dot-path traversal as a fallback for nested objects.
  const parts = key.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return formatPinValue(current);
}

const PIN_SOURCE_LABEL: Record<PinnedAttribute["source"], string> = {
  attribute: "attr",
  resource: "res",
};

function PinnedPill({
  pin,
  value,
  auto,
  onUnpin,
}: {
  pin: PinnedAttribute;
  value: string | null;
  auto: boolean;
  onUnpin: (source: PinnedAttribute["source"], key: string) => void;
}) {
  const display = value ?? "—";
  const label = pin.label ?? pin.key;
  // Auto-pins aren't unpinnable yet — they're driven by the trace having a
  // hoisted attribute. Make the pill non-interactive in that case so users
  // don't get confused by a missing-but-implied pin behaviour.
  if (auto) {
    return (
      <Tooltip
        content={
          <VStack align="stretch" gap={0.5} minWidth="160px">
            <TooltipRow label="Auto-pinned" value={pin.key} />
            <TooltipRow label="Value" value={display} />
            <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
              Always shown when present
            </Text>
          </VStack>
        }
        positioning={{ placement: "top" }}
      >
        <HStack
          gap={1.5}
          paddingX={2}
          paddingY={0.5}
          borderRadius="full"
          borderWidth="1px"
          borderColor="purple.500/30"
          bg="purple.500/8"
          maxWidth="280px"
        >
          <Icon as={LuSparkles} boxSize={3} color="purple.fg" flexShrink={0} />
          <Text
            textStyle="xs"
            color="purple.fg"
            fontFamily="mono"
            truncate
            maxWidth="100px"
          >
            {label}
          </Text>
          <Text
            textStyle="xs"
            color={value == null ? "fg.subtle" : "fg"}
            fontFamily="mono"
            fontWeight="medium"
            truncate
            maxWidth="160px"
          >
            {display}
          </Text>
        </HStack>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={0.5} minWidth="160px">
          <TooltipRow
            label={pin.source === "resource" ? "Resource" : "Attribute"}
            value={pin.key}
          />
          <TooltipRow label="Value" value={display} />
          <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
            Click to unpin
          </Text>
        </VStack>
      }
      positioning={{ placement: "top" }}
    >
      <HStack
        as="button"
        onClick={() => onUnpin(pin.source, pin.key)}
        gap={1.5}
        paddingX={2}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        bg="bg.panel"
        cursor="pointer"
        _hover={{ borderColor: "border.emphasized", bg: "bg.muted" }}
        aria-label={`Unpin ${pin.key}`}
        maxWidth="280px"
      >
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.04em"
          fontWeight="medium"
          flexShrink={0}
        >
          {PIN_SOURCE_LABEL[pin.source]}
        </Text>
        <Text
          textStyle="xs"
          color="fg.muted"
          fontFamily="mono"
          truncate
          maxWidth="100px"
        >
          {label}
        </Text>
        <Text
          textStyle="xs"
          color={value == null ? "fg.subtle" : "fg"}
          fontFamily="mono"
          fontWeight="medium"
          truncate
          maxWidth="160px"
        >
          {display}
        </Text>
        <Icon
          as={LuPinOff}
          boxSize={3}
          color="fg.subtle"
          flexShrink={0}
          opacity={0.6}
        />
      </HStack>
    </Tooltip>
  );
}
