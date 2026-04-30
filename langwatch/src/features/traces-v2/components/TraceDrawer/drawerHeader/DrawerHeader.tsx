import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuMaximize2,
  LuMinimize2,
  LuRefreshCw,
  LuX,
} from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import {
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuRoot,
} from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useConversationContext } from "../../../hooks/useConversationContext";
import { usePinnedAttributes } from "../../../hooks/usePinnedAttributes";
import { useTraceDrawerNavigation } from "../../../hooks/useTraceDrawerNavigation";
import { useTraceHeader } from "../../../hooks/useTraceHeader";
import { useTraceRefresh } from "../../../hooks/useTraceRefresh";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { useDrawerStore } from "../../../stores/drawerStore";
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
import { Chip } from "../Chip";
import { splitChipsForOverflow } from "../ChipBar";
import { ModeSwitch } from "../ModeSwitch";
import { RawJsonDialog } from "../RawJsonDialog";
import { useTraceHeaderChipDefs } from "../TraceHeaderChips";
import { MetricPill } from "./MetricPill";
import {
  type CategorizedPin,
  type PinCategory,
  PinDivider,
  renderPinPills,
} from "./PinStrip";
import { ThreadProgressIndicator } from "./ThreadProgressIndicator";
import { TooltipRow } from "./TooltipRow";
import { TraceOverflowMenu } from "./TraceOverflowMenu";
import { readNumberAttribute, resolveAttributeValue } from "./utils";

interface DrawerHeaderProps {
  trace: TraceHeader;
  /** Parent's drawer-close handler (URL teardown). */
  onClose: () => void;
}

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

/**
 * Curated hoisted attribute keys we always surface when present on a trace.
 * `category` controls grouping in the pin strip — identity (who/where), run
 * (which scenario/eval invocation), tag (labels). User pins fall into the
 * "custom" bucket.
 */
interface HoistedPinDef {
  key: string;
  label: string;
  category: PinCategory;
  /**
   * Resolve the value for this pin. Defaults to a plain attribute lookup,
   * but pins backed by a top-level `TraceHeader` field (conversation, user,
   * scenario run …) override this so the pill still renders when the
   * trace-summary projection populates the top-level column but not the
   * raw attribute.
   */
  resolve?: (trace: TraceHeader) => string | null | undefined;
}

const HOISTED_AUTO_PINS: HoistedPinDef[] = [
  // Conversation / thread are surfaced via the clickable
  // ThreadProgressIndicator in row 2 when this trace lives in a multi-turn
  // conversation. The auto-pins below stay as the fallback for single-turn
  // traces — the resolution logic skips them when the indicator is showing.
  //
  // Only `Conversation` is hoisted. The legacy `Thread` chip used to live
  // here and fell back to `conversationId` when no explicit thread was set,
  // which produced two chips with the same value side-by-side in the
  // header. Conversation is the canonical concept for callers; thread is
  // an implementation detail that can still be inspected via the
  // attributes section if it's actually set.
  {
    key: "gen_ai.conversation.id",
    label: "Conversation",
    category: "identity",
    resolve: (trace) =>
      trace.conversationId ?? trace.attributes["gen_ai.conversation.id"],
  },
  {
    key: "langwatch.user_id",
    label: "User",
    category: "identity",
    resolve: (trace) => trace.userId ?? trace.attributes["langwatch.user_id"],
  },
  {
    key: "scenario.run_id",
    label: "Scenario run",
    category: "run",
    resolve: (trace) =>
      trace.scenarioRunId ?? trace.attributes["scenario.run_id"],
  },
  { key: "evaluation.run_id", label: "Eval run", category: "run" },
  // Prompt enrichment lives on top-level summary fields rather than raw
  // attributes — these synthetic keys never collide with real OTel
  // attribute keys, so user pins keep a clean namespace.
  {
    key: "langwatch.prompt.selected",
    label: "Prompt",
    category: "run",
    resolve: (trace) => trace.selectedPromptId,
  },
  {
    key: "langwatch.prompt.last_used",
    label: "Last prompt",
    category: "run",
    // When selected and last-used are the same, only the "Prompt" pin
    // shows — duplicating the same handle adds noise to the strip.
    resolve: (trace) =>
      trace.lastUsedPromptId &&
      trace.lastUsedPromptId !== trace.selectedPromptId
        ? trace.lastUsedPromptId
        : null,
  },
  {
    key: "langwatch.prompt.version",
    label: "Prompt version",
    category: "run",
    resolve: (trace) =>
      trace.lastUsedPromptVersionNumber != null
        ? `v${trace.lastUsedPromptVersionNumber}`
        : (trace.lastUsedPromptVersionId ?? null),
  },
  { key: "langwatch.labels", label: "Labels", category: "tag" },
];

export const DrawerHeader = memo(function DrawerHeader({
  trace,
  onClose,
}: DrawerHeaderProps) {
  const isMaximized = useDrawerStore((s) => s.isMaximized);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const setActiveTab = useDrawerStore((s) => s.setActiveTab);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  const { canGoBack, goBack, goBackTo, backStackDepth, backStack } =
    useTraceDrawerNavigation();
  const headerQuery = useTraceHeader();
  const isNavigating = headerQuery.isFetching;

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
  const conversationContext = useConversationContext(
    trace.conversationId ?? null,
    trace.traceId,
  );
  const { pins, removePin } = usePinnedAttributes(project?.id);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const { closeDrawer, openDrawer } = useDrawer();
  // When the trace lives in a multi-turn conversation the
  // ThreadProgressIndicator already exposes the conversation id (with copy
  // + filter affordances), so the conversation / thread auto-pins would be
  // redundant. Skip them in that case to keep the strip lean.
  const conversationCoveredByIndicator = conversationContext.total > 1;
  // Resolve auto + user pins into a single array with category buckets so the
  // strip can group them with subtle dividers between identity / run / tag /
  // custom. Auto-pins are skipped when the user has already pinned the same
  // key explicitly so we never show the same row twice.
  const categorizedPins = useMemo<CategorizedPin[]>(() => {
    const userKeys = new Set(pins.map((p) => `${p.source}:${p.key}`));
    const out: CategorizedPin[] = [];
    // Per-key navigation handlers — keep these centralised so user pins
    // on the same key (e.g. someone manually pinning `scenario.run_id`)
    // pick up the same affordance for free.
    const buildNavigate = (
      key: string,
      value: string,
    ): { onNavigate: () => void; navigateLabel: string } | undefined => {
      switch (key) {
        case "gen_ai.conversation.id":
        case "langwatch.thread_id":
          return {
            navigateLabel: "Open conversation",
            onNavigate: () => setViewMode("conversation"),
          };
        case "scenario.run_id":
          return {
            navigateLabel: "Open scenario run",
            onNavigate: () =>
              openDrawer("scenarioRunDetail", {
                urlParams: { scenarioRunId: value },
              }),
          };
        case "langwatch.prompt.selected":
        case "langwatch.prompt.last_used":
        case "langwatch.prompt.version":
          // Prompt-related pins jump to the Prompts tab — and when we know
          // which span carried the prompt, focus it so the editor opens
          // on the right invocation rather than the trace's first span.
          return {
            navigateLabel: "Open prompt",
            onNavigate: () => {
              const spanId =
                key === "langwatch.prompt.selected"
                  ? trace.selectedPromptSpanId
                  : trace.lastUsedPromptSpanId;
              if (spanId) selectSpan(spanId);
              setActiveTab("prompts");
            },
          };
        default:
          return undefined;
      }
    };
    for (const def of HOISTED_AUTO_PINS) {
      if (
        conversationCoveredByIndicator &&
        (def.key === "gen_ai.conversation.id" ||
          def.key === "langwatch.thread_id")
      ) {
        continue;
      }
      if (userKeys.has(`attribute:${def.key}`)) continue;
      const resolved = def.resolve
        ? def.resolve(trace)
        : trace.attributes[def.key];
      const value = resolved ?? null;
      if (!value) continue;
      const filterField = FILTERABLE_PIN_FIELDS[def.key];
      const navigate = buildNavigate(def.key, value);
      out.push({
        pin: { source: "attribute", key: def.key, label: def.label },
        value,
        auto: true,
        category: def.category,
        onFilter: filterField
          ? () => {
              toggleFacet(filterField, value);
              closeDrawer();
            }
          : undefined,
        onNavigate: navigate?.onNavigate,
        navigateLabel: navigate?.navigateLabel,
      });
    }
    for (const p of pins) {
      const valueSource =
        p.source === "resource"
          ? resources.resourceAttributes
          : trace.attributes;
      const value = resolveAttributeValue(valueSource, p.key);
      const filterField = FILTERABLE_PIN_FIELDS[p.key];
      const navigate = value ? buildNavigate(p.key, value) : undefined;
      out.push({
        pin: p,
        value,
        auto: false,
        category: "custom",
        onFilter:
          filterField && value
            ? () => {
                toggleFacet(filterField, value);
                closeDrawer();
              }
            : undefined,
        onNavigate: navigate?.onNavigate,
        navigateLabel: navigate?.navigateLabel,
      });
    }
    return out;
  }, [
    pins,
    trace,
    resources.resourceAttributes,
    conversationCoveredByIndicator,
    toggleFacet,
    closeDrawer,
    openDrawer,
    setViewMode,
    setActiveTab,
    selectSpan,
  ]);

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

  const chipDefs = useTraceHeaderChipDefs(trace, {
    onSelectSpan: selectSpan,
    onOpenPromptsTab: () => setActiveTab("prompts"),
  });
  // Source chips: cap inline at 6 — anything beyond rolls into the "+N more"
  // popover so the strip stays scannable for traces with many capabilities.
  const { primary: primaryChips, overflowChip: chipsOverflow } =
    splitChipsForOverflow(chipDefs, 6);
  // Pins: auto-pins (identity/run/tag) always inline, custom pins capped at
  // 3 inline with the rest in a "+N pinned" popover. Anyone can pin
  // arbitrary attributes, so this keeps the row from running away.
  const pinResult = renderPinPills(categorizedPins, removePin, {
    maxCustomInline: 3,
  });

  return (
    <VStack align="stretch" gap={2} paddingX={4} paddingTop={3}>
      {/* Row 1: Title (back button + type badge + name + status) on the
          left, presence + actions on the right — collapsed from two rows so
          the trace name sits at the very top instead of after a near-empty
          peer/actions strip. */}
      <HStack justify="space-between" align="center" gap={2.5} minWidth={0}>
        <HStack gap={2.5} minWidth={0} flex={1} flexWrap="wrap" align="center">
          {canGoBack && (
            <MenuRoot>
              <Tooltip
                content={
                  <HStack gap={1}>
                    <Text>
                      {backStackDepth > 1
                        ? `Back (${backStackDepth} traces) — right-click for full history`
                        : "Back to previous trace"}
                    </Text>
                    <Kbd>B</Kbd>
                  </HStack>
                }
                positioning={{ placement: "bottom" }}
              >
                <MenuContextTrigger asChild>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={goBack}
                    aria-label="Back to previous trace"
                    flexShrink={0}
                  >
                    <Icon as={LuArrowLeft} boxSize={3.5} />
                  </Button>
                </MenuContextTrigger>
              </Tooltip>
              <MenuContent minWidth="240px">
                {/* Most-recent first so the visual order matches the
                    direction of "back" — top of menu = one step back. */}
                {backStack
                  .map((entry, idx) => ({ entry, idx }))
                  .reverse()
                  .map(({ entry, idx }) => {
                    const stepsBack = backStack.length - idx;
                    return (
                      <MenuItem
                        key={`${entry.traceId}:${idx}`}
                        value={`${idx}`}
                        onClick={() => goBackTo(idx)}
                      >
                        <Text textStyle="xs" color="fg.muted" minWidth="16px">
                          {stepsBack === 1 ? "←" : `${stepsBack}↑`}
                        </Text>
                        <Text
                          textStyle="xs"
                          fontFamily="mono"
                          flex={1}
                          truncate
                        >
                          {entry.traceId.slice(0, 16)}
                          <Text
                            as="span"
                            textStyle="2xs"
                            color="fg.subtle"
                            marginLeft={2}
                          >
                            {entry.viewMode}
                          </Text>
                        </Text>
                      </MenuItem>
                    );
                  })}
              </MenuContent>
            </MenuRoot>
          )}
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
            minWidth={0}
          >
            {trace.rootSpanName ?? trace.name}
          </Text>
          <HStack gap={1} flexShrink={0}>
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
          {conversationContext.total > 1 && (
            <ThreadProgressIndicator
              position={conversationContext.position}
              total={conversationContext.total}
              conversationId={trace.conversationId}
              onFilterByConversation={
                trace.conversationId
                  ? () => {
                      toggleFacet("conversation", trace.conversationId!);
                      closeDrawer();
                    }
                  : undefined
              }
              isLoading={isNavigating}
            />
          )}
        </HStack>

        <HStack gap={1} flexShrink={0}>
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
              onClick={toggleMaximized}
              aria-label={isMaximized ? "Restore drawer" : "Maximize drawer"}
            >
              <Icon
                as={isMaximized ? LuMinimize2 : LuMaximize2}
                boxSize={3.5}
              />
            </Button>
          </Tooltip>
          <TraceOverflowMenu
            traceId={trace.traceId}
            conversationId={trace.conversationId}
            onCopyTraceId={handleCopyTraceId}
            onFindSimilar={findSimilarQuery ? handleFindSimilar : null}
            dejaViewHref={dejaView.href ?? null}
            onOpenRawJson={() => setRawOpen(true)}
            onShowShortcuts={() => setShortcutsOpen(true)}
          />
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
              paddingX={3}
              minWidth="auto"
              color="fg.muted"
              _hover={{ bg: "bg.muted", color: "fg" }}
              _active={{ bg: "bg.emphasized" }}
            >
              <Icon as={LuX} boxSize={5} strokeWidth={2.25} />
            </Button>
          </Tooltip>
        </HStack>
      </HStack>

      {/* Row 2: Unified context strip. Three logical sections — performance
          metrics, pinned context, source/tools chips — flow into one wrapped
          row separated by thin vertical dividers. The right end slot anchors
          the trace ID + relative timestamp. Collapsing what used to be three
          separate rows keeps the header dense without losing categorisation. */}
      <HStack gap={1.5} flexWrap="wrap" align="center">
        {/* Section 1: Performance metrics */}
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

        {/* Section 2: Source / tools chips (service, origin, scenario, sdk,
            prompts, annotations). Capped at 6 inline; surplus rolls into
            the standard "+N more" popover. */}
        {(primaryChips.length > 0 || chipsOverflow) && <PinDivider />}
        {primaryChips.map((c) => (
          <Chip key={c.id} {...c} />
        ))}
        {chipsOverflow}
      </HStack>

      {/* Row 4: Dedicated pinned-context strip — auto-pins (identity / run /
          tag) inline with intra-category dividers, custom pins capped at 3
          inline with the rest in a "+N pinned" overflow popover. Lives on
          its own row so the categorisation stays scannable; renders nothing
          when there's no pinned context. */}
      {(pinResult.inline.length > 0 || pinResult.overflow) && (
        <HStack gap={1.5} flexWrap="wrap" align="center">
          {pinResult.inline}
          {pinResult.overflow}
        </HStack>
      )}

      {/* Row 5: Inline mode tabs — Trace / Conversation. Trace ID + relative
          timestamp tuck into the right corner of the same row, so they
          aren't claiming a slot in the chip strip above. */}
      <Box marginX={-4}>
        <ModeSwitch
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hasConversation={!!trace.conversationId}
          traceId={trace.traceId}
          endSlot={
            <HStack gap={2}>
              {/* Presence avatars sit at the trailing edge of the mode-tab
                  row — out of the way of the title and not crowding the
                  action cluster. Copy trace ID lives in the overflow
                  menu / `Y` shortcut, so the inline chip is gone. */}
              <TracePresenceAvatars
                traceId={trace.traceId}
                max={5}
                size="2xs"
              />
              <Text textStyle="xs" color="fg.subtle">
                {formatRelativeTime(trace.timestamp)}
              </Text>
            </HStack>
          }
        />
      </Box>
      <RawJsonDialog
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        trace={trace}
      />
    </VStack>
  );
});
