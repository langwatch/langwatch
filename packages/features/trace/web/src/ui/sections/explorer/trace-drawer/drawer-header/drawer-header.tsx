import {
  Box,
  Button,
  Circle,
  HoverCard,
  HStack,
  Icon,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuCopy,
  LuMaximize2,
  LuMinimize2,
  LuRefreshCw,
  LuShare2,
  LuX,
} from "react-icons/lu";
import { PersonalFeatureGateDialog } from "../../../me/personal-feature-gate-dialog.tsx";
import { usePersonalFeatureGate } from "../../../me/use-personal-feature-gate.ts";
import { Kbd } from "@langwatch/ops-web/surfaces/keyboard-key";
import { MenuContent, MenuContextTrigger, MenuItem, MenuRoot } from "@langwatch/design-system/menu";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { toaster } from "@langwatch/design-system/toaster";
import { showErrorToast } from "../../../errors/index.ts";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TracePresenceAvatars } from "@langwatch/presence-web/surfaces/presence-indicators";
import { useDejaViewLink } from "../../../use-deja-view-link.ts";
import { useDrawer } from "../../../../../behavior/use-drawer.ts";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project.ts";
import type { TraceHeader } from "@langwatch/trace-contract";
import { useConversationContext } from "../../hooks/use-conversation-context.ts";
import { usePinnedAttributes } from "../../hooks/use-pinned-attributes.ts";
import { useSpanTree } from "../../hooks/use-span-tree.ts";
import { useTraceDrawerNavigation } from "../../hooks/use-trace-drawer-navigation.ts";
import { useTraceRefresh } from "../../hooks/use-trace-refresh.ts";
import { useTraceResources } from "../../hooks/use-trace-resources.ts";
import { useDrawerStore } from "../../../../../behavior/drawer.store.ts";
import { useFilterStore } from "../../../../../behavior/filter.store.ts";
import { useFocusSectionStore } from "../../../../../behavior/focus-section.store.ts";
import {
  formatAbsoluteTime,
  formatCost,
  formatDuration,
  formatRelativeTimeAgo,
  formatTokens,
  STATUS_COLORS,
} from "../../../../../model/display-formatters.ts";
import { isTerminalOrigin } from "../../../../../model/terminal-origin.ts";
import { EditableTraceName } from "../../../editable-trace-name.tsx";
import { rankedErrorSpans } from "../../../../../model/explorer/error-spans.ts";
import { guardTraceEditExit } from "../../utils/trace-edit-mode.ts";
import { AddToAnnotationQueueDialog } from "../../add-to-annotation-queue-dialog.tsx";
import { CostBreakdownTooltipContent } from "../../shared/cost-breakdown-tooltip.tsx";
import { TokenBreakdownTooltipContent } from "../../../../blocks/explorer/shared/token-breakdown-tooltip.tsx";
import { ModelsTooltip } from "../../trace-table/registry/cells/trace/model-cell.tsx";
import { Chip } from "../../../../elements/explorer/trace-drawer/chip.tsx";
import { splitChipsForOverflow } from "../../../../blocks/explorer/trace-drawer/chip-bar.tsx";
import { ExceptionsContent } from "../../../../elements/explorer/trace-drawer/exceptions-content.tsx";
import { EditedOriginalToggle } from "../edit-mode/edited-original-toggle.tsx";
import { ModeSwitch } from "../mode-switch.tsx";
import { RawJsonDialog } from "../raw-json-dialog.tsx";
import { useTraceHeaderChipDefs } from "../trace-header-chips.tsx";
import { MetricPill } from "./metric-pill.tsx";
import { type CategorizedPin, type PinCategory, renderPinPills } from "./pin-strip.tsx";
import { ShareTraceDialog } from "./share-trace-dialog.tsx";
import { SyntheticTraceBadge } from "../../../../blocks/explorer/trace-drawer/drawer-header/synthetic-trace-badge.tsx";
import { TraceOverflowMenu } from "./trace-overflow-menu.tsx";
import { useRetainedTraceHeader } from "../../../../../behavior/explorer/trace-drawer/drawer-header/use-retained-trace-header.ts";
import {
  formatPinValue,
  readNumberAttribute,
  resolveAttributeValue,
} from "../../../../../model/explorer/trace-drawer/drawer-header/utils.ts";

interface DrawerHeaderProps {
  trace: TraceHeader;
  /** Parent's drawer-close handler (URL teardown). */
  onClose: () => void;
  /**
   * Public share view: no session, no drawer to close. Suppresses every
   * affordance that mutates, needs a session, or only makes sense inside the
   * drawer chrome. See TraceViewerContext.
   */
  readOnly?: boolean;
}

/**
 * Inline trace ID chip, collapsed by default so it doesn't compete with the trace name; expands
 * to the full ID with a copy icon on hover.
 */
function TraceIdChip({ traceId }: { traceId: string }) {
  const short = traceId.slice(0, 8);
  const handleCopy = async () => {
    // navigator.clipboard requires a secure context (https or localhost).
    // Surface a friendly hint when it fails so users running LangWatch on
    // a plain-http internal domain understand what went wrong instead of
    // seeing a silent no-op.
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(traceId);
        toaster.create({
          title: "Trace ID copied",
          // Show the full id so the operator can verify what landed on
          // their clipboard at a glance. The chip shows a short id by
          // design (git-SHA convention) but the toast has the real
          // estate — operator report: the previous "<8 chars>…" felt
          // truncated for no benefit.
          description: traceId,
          type: "success",
          duration: 2500,
        });
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      showErrorToast({
        fallbackTitle: "Couldn't copy trace ID",
        description:
          "Clipboard access is restricted. This can happen on non-HTTPS domains. Copy the ID manually from the URL.",
      });
    }
  };
  const value = (
    <Box
      display="inline-flex"
      alignItems="center"
      gap={1}
      fontFamily="mono"
      // Hover affordances: swap short text for full id, reveal the copy
      // icon. CSS-only so we don't need a React state per row of header.
      css={{
        "& [data-hover-only]": { display: "none" },
        ".chip-root:hover & [data-hover-only]": { display: "inline-flex" },
        ".chip-root:hover & [data-collapsed]": { display: "none" },
        ".chip-root:hover & [data-expanded]": { display: "inline" },
      }}
    >
      <Text as="span" data-collapsed textStyle="xs" color="fg" fontWeight="medium">
        {short}
      </Text>
      <Text as="span" data-expanded textStyle="xs" color="fg" fontWeight="medium" display="none">
        {traceId}
      </Text>
      <Icon as={LuCopy} boxSize={3} color="fg.muted" data-hover-only />
    </Box>
  );
  return (
    <Chip
      value={value}
      tone="neutral"
      onClick={() => void handleCopy()}
      tooltip="Hover to see full ID, click to copy"
      ariaLabel={`Copy trace ID ${traceId}`}
    />
  );
}

/**
 * Trace status indicator.
 */
function StatusChip({ trace, statusColor }: { trace: TraceHeader; statusColor: string }) {
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const requestFocus = useFocusSectionStore((s) => s.request);
  const spanTree = useSpanTree();
  const errorSpans = useMemo(() => rankedErrorSpans(spanTree.data ?? []), [spanTree.data]);

  const isError = trace.status === "error";
  const hasErrorContent = isError && (!!trace.error || errorSpans.length > 0);

  const focusExceptions = useCallback(() => {
    // After the trace-view redesign Summary is its own DrawerViewMode,
    // not a SpanTabBar tab — so jumping to the trace's Exceptions
    // section means flipping mode to "summary" and pulsing the
    // section, not setting an `activeTab`.
    setViewMode("summary");
    requestFocus({ traceId: trace.traceId, section: "exceptions" });
  }, [requestFocus, setViewMode, trace.traceId]);

  // Same focus request without the mode override — used by span pills
  // inside the popover so a follow-up `selectSpan` lands the user on the
  // span detail. The pulse target component (SpanAccordions or
  // TraceSummaryAccordions) observes the shared focus store regardless
  // of where it's mounted.
  const focusExceptionsKeepTab = useCallback(() => {
    requestFocus({ traceId: trace.traceId, section: "exceptions" });
  }, [requestFocus, trace.traceId]);

  const jumpToSpan = useCallback(
    (spanId: string) => {
      // Land on the trace pane with the span selected. `setViewMode` flips the drawer
      // to the trace-pane layout (PaneLayout); the SpanDetailPane mounts because
      // `selectedSpanId` is now set, and the SpanTabBar highlights the selected span.
      setViewMode("trace");
      selectSpan(spanId);
    },
    [selectSpan, setViewMode],
  );

  // OK / non-error rendering keeps the existing static-tooltip recipe —
  // there's nothing to preview, no jump to make.
  if (!isError) {
    const tooltipContent =
      trace.status === "ok"
        ? "No errors recorded on any span in this trace"
        : `Trace status: ${trace.status}`;
    return (
      <Tooltip content={tooltipContent} positioning={{ placement: "bottom" }}>
        <HStack gap={1} flexShrink={0} cursor="help">
          <Circle size="8px" bg={statusColor} flexShrink={0} />
        </HStack>
      </Tooltip>
    );
  }

  const chipBody = (
    <HStack
      as="button"
      gap={1}
      flexShrink={0}
      cursor="pointer"
      onClick={focusExceptions}
      aria-label="Show exception details for this trace"
      paddingX={1}
      paddingY={0.5}
      borderRadius="md"
      _hover={{ bg: "red.fg/10" }}
      transition="background 0.15s ease"
    >
      <Circle size="8px" bg={statusColor} flexShrink={0} />
      <Text textStyle="xs" fontWeight="medium" color={statusColor} textTransform="capitalize">
        {trace.status}
      </Text>
    </HStack>
  );

  // No content to preview — degrade to the plain clickable chip.
  // Click still focuses the (empty) Exceptions section so the
  // operator at least lands on the right tab.
  if (!hasErrorContent) return chipBody;

  return (
    <HoverCard.Root
      openDelay={150}
      closeDelay={120}
      positioning={{ placement: "bottom-start", gutter: 6 }}
    >
      <HoverCard.Trigger asChild>{chipBody}</HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            minWidth="280px"
            maxWidth="420px"
            padding={3}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
          >
            <ExceptionsContent
              error={trace.error}
              errorSpans={errorSpans}
              onSelectSpan={jumpToSpan}
              onFocusSection={focusExceptionsKeepTab}
              density="compact"
            />
            {/* Anchor row: nudges the operator that the popover is a
                preview of the full Exceptions section, and clicking
                the chip itself opens it. Matches the deep-link style
                used on the eval header chips. */}
            <HStack
              gap={1}
              paddingTop={2}
              marginTop={2}
              borderTopWidth="1px"
              borderTopColor="border.muted"
            >
              <Text textStyle="2xs" color="fg.muted">
                Click the chip to open the Exceptions section
              </Text>
            </HStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
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
 * Liqe field names are bare identifiers — letters, digits, dots, underscores, dashes.
 */
const SAFE_METADATA_KEY_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Build a Liqe-style fielded query for an auto-pinned metadata value. Escapes embedded
 * quotes + backslashes in the value so things like `tenant="org \"acme\""` stay
 * parseable.
 */
function formatMetadataFilterQuery({ key, value }: { key: string; value: string }): string | null {
  if (!SAFE_METADATA_KEY_RE.test(key)) return null;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!escaped) return null;
  return `${key}:"${escaped}"`;
}

/**
 * Curated hoisted attribute keys we always surface when present on a trace. `category`
 * controls grouping in the pin strip — identity (who/where), run (which scenario/eval
 * invocation), tag (labels). User pins fall into the "custom" bucket.
 */
interface HoistedPinDef {
  key: string;
  label: string;
  category: PinCategory;
  /**
   * Resolve the value for this pin.
   */
  resolve?: (trace: TraceHeader) => string | null | undefined;
}

const HOISTED_AUTO_PINS: HoistedPinDef[] = [
  // Only `Conversation` is hoisted. The legacy `Thread` chip used to live here and fell
  // back to `conversationId` when no explicit thread was set, which produced two chips
  // with the same value side-by-side in the header.
  {
    key: "gen_ai.conversation.id",
    label: "Conversation",
    category: "identity",
    resolve: (trace) => trace.conversationId ?? trace.attributes["gen_ai.conversation.id"],
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
    resolve: (trace) => trace.scenarioRunId ?? trace.attributes["scenario.run_id"],
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
      trace.lastUsedPromptId && trace.lastUsedPromptId !== trace.selectedPromptId
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

/**
 * Metadata keys the auto-pin sweep leaves alone, because the metrics row one line above
 * already states them: the Model / Models pill is built from `trace.models` and folds
 * the rest behind a "+N" with the full list on hover.
 */
const AUTO_PIN_SUPPRESSED_METADATA_KEYS = new Set(["metadata.model", "metadata.models"]);

export const DrawerHeader = memo(function DrawerHeader({
  trace: traceProp,
  onClose,
  readOnly = false,
}: DrawerHeaderProps) {
  // Retain attribute-derived fields across payload flaps (row-data seed →
  // full summary → refetch) so chips never vanish once shown for the same
  // traceId — see useRetainedTraceHeader for the root-cause writeup.
  const trace = useRetainedTraceHeader(traceProp);
  const isMaximized = useDrawerStore((s) => s.isMaximized);
  const pinned = useDrawerStore((s) => s.pinned);
  const togglePinned = useDrawerStore((s) => s.togglePinned);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const isEditing = useDrawerStore((s) => s.isEditing);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
  const toggleSnapMaximize = useDrawerStore((s) => s.toggleSnapMaximize);
  // The Maximize / Restore icon drives the same width snap that double-clicking the
  // edge grip uses — `widthPx` is the actual size signal, while the boolean
  // `isMaximized` is kept in sync for components that read it to swap the icon label.
  const handleMaximizeClick = () => {
    if (typeof window === "undefined") {
      toggleMaximized();
      return;
    }
    toggleSnapMaximize(window.innerWidth);
  };
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  const { canGoBack, goBack, goBackTo, backStackDepth, backStack } = useTraceDrawerNavigation();

  const statusColor = STATUS_COLORS[trace.status] as string;
  const { project, hasPermission } = useOrganizationTeamProject();
  // Sharing a trace is how a reviewer hands it to someone without an account,
  // which is frequent enough that it earns a button rather than a click into
  // the overflow menu. Gated on the same permission the menu item used.
  const canShare = hasPermission("traces:share");
  const dejaView = useDejaViewLink({
    aggregateId: trace.traceId,
    tenantId: project?.id,
    enabled: !readOnly,
  });

  const {
    cacheCreation1hTokens,
    cacheCreation5mTokens,
    cacheCreationTokens,
    cacheReadTokens,
    contextSizeTokens,
    reasoningEffort,
    reasoningTokens,
  } = readTokenUsage(trace.attributes);

  // Total tokens the model actually processed = input + output PLUS cache read + cache
  // write.
  const totalTokensWithCache =
    trace.totalTokens + (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0);

  // If we have concrete input AND output token numbers to display, trust them
  // and suppress the "estimated" caveat — historical trace summaries can carry
  // a stale `tokensEstimated=true` from before the per-span fix landed, so
  // gating on actual presence here keeps the popover honest without a backfill.
  const hasAuthoritativeTokens =
    trace.inputTokens != null &&
    trace.outputTokens != null &&
    (trace.inputTokens > 0 || trace.outputTokens > 0);

  // Billed vs non-billed cost. `totalCost` is the grand list-price cost;
  // `nonBilledCost` is the bundled (theoretical) portion a coding assistant on
  // a flat plan never actually pays per token. The pill shows the billed
  // amount (real spend) so a bundled session doesn't read as huge spend; the
  // popover breaks down the split.
  const grandCost = trace.totalCost ?? 0;
  const nonBilledCost = trace.nonBilledCost ?? 0;
  const billedCost = Math.max(0, grandCost - nonBilledCost);
  const isBundledCost = nonBilledCost > 0;

  const resources = useTraceResources(trace.traceId);
  const conversationContext = useConversationContext(trace.conversationId ?? null, trace.traceId);
  const { pins, removePin } = usePinnedAttributes(project?.id);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  // `applyQueryTextFromPin` is used by the auto-pinned metadata filter
  // affordance below. Pulled at the parent scope so the `useMemo` for
  // `categorizedPins` doesn't need to re-subscribe to the store on every
  // pin shape change.
  const applyQueryTextFromPin = useFilterStore((s) => s.applyQueryText);
  const { closeDrawer, openDrawer } = useDrawer();
  // Resolve auto + user pins into a single array with category buckets so the
  // strip can group them with subtle dividers between identity / run / tag /
  // custom. Auto-pins are skipped when the user has already pinned the same
  // key explicitly so we never show the same row twice.
  const categorizedPins = useMemo<CategorizedPin[]>(
    () =>
      categorizePins({
        applyQueryTextFromPin,
        closeDrawer,
        openDrawer,
        pins,
        resourceAttributes: resources.resourceAttributes,
        selectSpan,
        setViewMode,
        toggleFacet,
        trace,
      }),
    [
      pins,
      trace,
      resources.resourceAttributes,
      toggleFacet,
      applyQueryTextFromPin,
      closeDrawer,
      openDrawer,
      setViewMode,
      selectSpan,
    ],
  );

  const handleCopyTraceId = () => {
    void navigator.clipboard.writeText(trace.traceId);
  };

  const [rawOpen, setRawOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [annotationQueueOpen, setAnnotationQueueOpen] = useState(false);
  const annotationGate = usePersonalFeatureGate("annotations");

  const handleAddToAnnotationQueue = useCallback(async () => {
    const allowed = await annotationGate.requestEnable();
    if (!allowed) return;
    setAnnotationQueueOpen(true);
  }, [annotationGate]);

  // Local listener for the `\` shortcut. Lives here (rather than in
  // TraceDrawerShell) because the raw-JSON dialog's open state is also
  // local — keeping both colocated avoids lifting state purely for the
  // sake of a single shortcut.
  useEffect(() => listenForRawJsonShortcut(setRawOpen), []);

  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  // Build a query string from the highest-signal axes available on this trace.
  // Service + status are usually present; root span name is a strong cluster
  // signal. We quote bare strings to keep liqe happy with spaces/dashes.
  const findSimilarQuery = useMemo(
    () => buildFindSimilarQuery(trace),
    [trace.serviceName, trace.status, trace.traceName],
  );
  const handleFindSimilar = useCallback(() => {
    if (!findSimilarQuery) return;
    guardTraceEditExit(() => {
      applyQueryText(findSimilarQuery);
      closeDrawer();
    });
  }, [applyQueryText, closeDrawer, findSimilarQuery]);

  const { refresh: handleRefresh, isRefreshing } = useTraceRefresh(trace.traceId);

  // Title fallback chain: explicit traceName attribute → root span name (the server
  // populates `trace.name` from it) → trace ID prefix as a last resort.
  const { titleText, titleIsFallback } = useMemo(
    () => resolveHeaderTitle(trace),
    [trace.traceName, trace.name, trace.traceId],
  );

  const chipDefs = useTraceHeaderChipDefs(trace, {
    onSelectSpan: selectSpan,
    // `onOpenPromptsTab` is a no-op after the redesign — selecting the
    // span (via `onSelectSpan`) lands the user on SpanDetailPane and
    // the body adapts to show the PromptsPanel automatically.
    onOpenPromptsTab: () => {
      // intentional no-op — see comment above
    },
  });
  // Source chips: cap inline at 10 so multi-evaluator traces don't hide
  // their second & third verdicts in the overflow popover by default —
  // eval status is the highest-signal data on the strip, not something
  // to bury after a half-dozen capabilities. Anything beyond 10 still
  // rolls into "+N more" so the row stays scannable.
  const { primary: primaryChips, overflowChip: chipsOverflow } = splitChipsForOverflow(
    chipDefs,
    10,
  );
  // Pins: auto-pins (identity/run/tag) always inline. Custom + metadata pins inline up
  // to MAX_INLINE_PINS — the rest still spill into the overflow popover so a
  // pathological 200-pin trace can't blow out the header.
  const MAX_INLINE_PINS = 12;
  const pinResult = renderPinPills(categorizedPins, removePin, {
    maxCustomInline: MAX_INLINE_PINS,
  });

  return (
    <VStack align="stretch" gap={2} paddingX={4} paddingTop={3}>
      {/* Row 1: Trace ID chip + title + status on the left, actions
          on the right. The Trace ID chip leads the row (replacing the
          previous LLM root-span-type badge — that badge was almost
          always "span" or "llm" and added noise instead of signal).
          The chip itself shows only the id (no "Trace ID" label),
          with hover-to-expand + click-to-copy. */}
      <HStack justify="space-between" align="center" gap={2.5} minWidth={0}>
        <HeaderIdentity
          backStack={backStack}
          backStackDepth={backStackDepth}
          canGoBack={canGoBack}
          goBack={goBack}
          goBackTo={goBackTo}
          project={project}
          readOnly={readOnly}
          statusColor={statusColor}
          titleIsFallback={titleIsFallback}
          titleText={titleText}
          trace={trace}
        />

        {/* Negative margins cancel the header padding so the close button sits flush with the
            drawer edge, matching the other drawers' absolutely-positioned DrawerCloseTrigger. */}
        {/* The whole action cluster is drawer chrome or needs a session:
            refresh, maximize, the overflow menu (which fires
            `pinnedTrace.getPin` on mount), dock and close. It must be
            unmounted, not hidden — `display:none` would still run the menu's
            queries. */}
        {!readOnly && (
          <HeaderActions
            canShare={canShare}
            dejaViewHref={dejaView.href ?? null}
            isMaximized={isMaximized}
            isRefreshing={isRefreshing}
            onAddToAnnotationQueue={handleAddToAnnotationQueue}
            onClose={onClose}
            onCopyTraceId={handleCopyTraceId}
            onFindSimilar={findSimilarQuery ? handleFindSimilar : null}
            onMaximizeClick={handleMaximizeClick}
            onOpenRawJson={() => setRawOpen(true)}
            onRefresh={handleRefresh}
            onShare={() => setShareOpen(true)}
            onShowShortcuts={() => setShortcutsOpen(true)}
            onTogglePinned={togglePinned}
            pinned={pinned}
            readOnly={readOnly}
            trace={trace}
          />
        )}
      </HStack>

      {/* Row 2: performance metrics, pinned context, and source/tools chips flow into one wrapped
          strip so a single row of pills doesn't carry a permanent empty band underneath. */}
      <HeaderMetricsRow
        billedCost={billedCost}
        cacheCreation1hTokens={cacheCreation1hTokens}
        cacheCreation5mTokens={cacheCreation5mTokens}
        cacheCreationTokens={cacheCreationTokens}
        cacheReadTokens={cacheReadTokens}
        chipsOverflow={chipsOverflow}
        contextSizeTokens={contextSizeTokens}
        grandCost={grandCost}
        hasAuthoritativeTokens={hasAuthoritativeTokens}
        isBundledCost={isBundledCost}
        nonBilledCost={nonBilledCost}
        primaryChips={primaryChips}
        reasoningEffort={reasoningEffort}
        reasoningTokens={reasoningTokens}
        totalTokensWithCache={totalTokensWithCache}
        trace={trace}
      />

      {/* Pin strip only renders when there's something to show — many traces have no auto-pins,
          and a small height jump between trace-with-pins and trace-without beats dead chrome. */}
      {(pinResult.inline.length > 0 || pinResult.overflow != null) && (
        <HStack gap={1.5} flexWrap="wrap" align="center" alignContent="flex-start">
          {pinResult.inline}
          {pinResult.overflow}
        </HStack>
      )}

      {/* Row 5: Inline mode tabs — Trace / Conversation. Trace ID + relative
          timestamp tuck into the right corner of the same row, so they
          aren't claiming a slot in the chip strip above. */}
      <HeaderModeSwitch
        conversationContext={conversationContext}
        isEditing={isEditing}
        onViewModeChange={setViewMode}
        readOnly={readOnly}
        trace={trace}
        viewMode={viewMode}
      />
      <RawJsonDialog open={rawOpen} onClose={() => setRawOpen(false)} trace={trace} />
      {!readOnly && (
        <SessionOnlyDialogs
          annotationGate={annotationGate}
          annotationQueueOpen={annotationQueueOpen}
          onCloseAnnotationQueue={() => setAnnotationQueueOpen(false)}
          onCloseShare={() => setShareOpen(false)}
          projectId={project?.id}
          shareOpen={shareOpen}
          traceId={trace.traceId}
        />
      )}
    </VStack>
  );
});

/**
 * Cache and reasoning totals are summed across the trace's spans by the fold and
 * parked on reserved keys (the raw per-span `gen_ai.usage.cache_*` values never
 * reach the trace attribute map), so the reserved sums are read first and the raw
 * keys are the fallback for traces folded before the sum landed.
 */
function readTokenUsage(attributes: TraceHeader["attributes"]): {
  cacheCreation1hTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  contextSizeTokens: number | null;
  reasoningEffort: string | null;
  reasoningTokens: number | null;
} {
  return {
    // Anthropic's cache-write TTL split (5m writes bill 1.25x base input, 1h
    // writes 2x), summed by the fold off the response bodies. Absent for every
    // other provider and for sessions without raw body telemetry.
    cacheCreation1hTokens: readNumberAttribute(
      attributes,
      "langwatch.reserved.cache_creation_1h_tokens",
    ),
    cacheCreation5mTokens: readNumberAttribute(
      attributes,
      "langwatch.reserved.cache_creation_5m_tokens",
    ),
    cacheCreationTokens: readNumberAttribute(
      attributes,
      "langwatch.reserved.cache_creation_tokens",
      "gen_ai.usage.cache_creation.input_tokens",
    ),
    cacheReadTokens: readNumberAttribute(
      attributes,
      "langwatch.reserved.cache_read_tokens",
      "gen_ai.usage.cache_read.input_tokens",
      "gen_ai.usage.cached_tokens",
    ),
    // How full the window already was when this trace's first model call ran.
    // Read before Tokens because the sums only mean something once you know
    // what they started from.
    contextSizeTokens: readNumberAttribute(attributes, "langwatch.reserved.context_size_tokens"),
    // The reasoning EFFORT request setting (low/medium/high/…), distinct from
    // the reasoning TOKEN count: it is a per-request model setting.
    reasoningEffort: attributes?.["gen_ai.request.reasoning_effort"]?.trim() ?? null,
    reasoningTokens: readNumberAttribute(
      attributes,
      "langwatch.reserved.reasoning_tokens",
      "gen_ai.usage.reasoning_tokens",
    ),
  };
}

/**
 * The `\` shortcut for the raw-JSON dialog. Lives beside the dialog's own local
 * open state rather than in the shell, so neither has to be lifted for the sake
 * of one shortcut.
 */
function listenForRawJsonShortcut(setRawOpen: (update: (open: boolean) => boolean) => void) {
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "\\") return;
    e.preventDefault();
    setRawOpen((v) => !v);
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}

/**
 * A query built from the highest-signal axes this trace has. Service and status
 * are usually present; the root span name is a strong cluster signal. Bare
 * strings are quoted to keep liqe happy with spaces and dashes.
 */
function buildFindSimilarQuery(trace: TraceHeader): string {
  const parts: string[] = [];
  if (trace.serviceName) parts.push(`service:"${trace.serviceName}"`);
  if (trace.status === "error") parts.push("status:error");
  if (trace.traceName) {
    const escaped = trace.traceName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    parts.push(`"${escaped}"`);
  }
  return parts.join(" ");
}

/**
 * Title fallback chain: the explicit traceName attribute, then the root span
 * name (the server populates `trace.name` from it), then the trace id prefix.
 */
function resolveHeaderTitle(trace: TraceHeader): {
  titleText: string;
  titleIsFallback: boolean;
} {
  const explicit = trace.traceName?.trim();
  if (explicit) return { titleText: explicit, titleIsFallback: false };
  const spanName = trace.name?.trim();
  if (spanName && spanName !== trace.traceId && !trace.traceId.startsWith(spanName)) {
    return { titleText: spanName, titleIsFallback: false };
  }
  return { titleText: trace.traceId.slice(0, 12), titleIsFallback: true };
}

interface PinBuildContext {
  applyQueryTextFromPin: (query: string) => void;
  closeDrawer: () => void;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  pins: ReturnType<typeof usePinnedAttributes>["pins"];
  resourceAttributes: ReturnType<typeof useTraceResources>["resourceAttributes"];
  selectSpan: ReturnType<typeof useDrawerStore.getState>["selectSpan"];
  setViewMode: ReturnType<typeof useDrawerStore.getState>["setViewMode"];
  toggleFacet: ReturnType<typeof useFilterStore.getState>["toggleFacet"];
  trace: TraceHeader;
}

type PinNavigation = { onNavigate: () => void; navigateLabel: string } | undefined;

/**
 * Where a pin's key can take the reader. Centralised so a user pin on the same
 * key (someone manually pinning `scenario.run_id`, say) picks up the same
 * affordance for free.
 */
function pinNavigation({
  ctx,
  key,
  value,
}: {
  ctx: PinBuildContext;
  key: string;
  value: string;
}): PinNavigation {
  if (key === "gen_ai.conversation.id" || key === "langwatch.thread_id") {
    return {
      navigateLabel: "Open conversation",
      onNavigate: () => ctx.setViewMode("conversation"),
    };
  }
  if (key === "scenario.run_id") {
    return {
      navigateLabel: "Open scenario run",
      onNavigate: () =>
        ctx.openDrawer("scenarioRunDetail", { urlParams: { scenarioRunId: value } }),
    };
  }
  if (!PROMPT_PIN_KEYS.has(key)) return undefined;
  // Prompts is no longer a separate tab — SpanDetailPane auto-renders the
  // PromptsPanel when the selected span has prompt data, so selecting the span
  // that carried the prompt is all this does, and the panel adapts.
  return {
    navigateLabel: "Open prompt",
    onNavigate: () => {
      const spanId =
        key === "langwatch.prompt.selected"
          ? ctx.trace.selectedPromptSpanId
          : ctx.trace.lastUsedPromptSpanId;
      if (spanId) ctx.selectSpan(spanId);
    },
  };
}

const PROMPT_PIN_KEYS = new Set([
  "langwatch.prompt.selected",
  "langwatch.prompt.last_used",
  "langwatch.prompt.version",
]);

/** Filtering the trace table by a pin's own field, once the reader is free to leave. */
function pinFacetFilter({
  ctx,
  field,
  value,
}: {
  ctx: PinBuildContext;
  field: string;
  value: string;
}): () => void {
  return () =>
    guardTraceEditExit(() => {
      ctx.toggleFacet(field, value);
      ctx.closeDrawer();
    });
}

/** The hoisted auto-pins this trace carries a value for. */
function hoistedAutoPins(ctx: PinBuildContext, userKeys: Set<string>): CategorizedPin[] {
  const out: CategorizedPin[] = [];
  for (const def of HOISTED_AUTO_PINS) {
    // The rich `Scenario run` chip (built from `useScenarioChipData` in
    // `TraceHeaderChips`) already surfaces the scenario run id with status,
    // criteria and click-to-open behaviour.
    const scenarioChipShowsIt =
      def.key === "scenario.run_id" &&
      !!(ctx.trace.scenarioRunId ?? ctx.trace.attributes["scenario.run_id"]);
    if (scenarioChipShowsIt) continue;
    if (userKeys.has(`attribute:${def.key}`)) continue;
    const resolved = def.resolve ? def.resolve(ctx.trace) : ctx.trace.attributes[def.key];
    const value = formatPinValue({ key: def.key, value: resolved ?? null });
    if (!value) continue;
    const filterField = FILTERABLE_PIN_FIELDS[def.key];
    const navigate = pinNavigation({ ctx, key: def.key, value });
    out.push({
      pin: { source: "attribute", key: def.key, label: def.label },
      value,
      auto: true,
      category: def.category,
      onFilter: filterField ? pinFacetFilter({ ctx, field: filterField, value }) : undefined,
      onNavigate: navigate?.onNavigate,
      navigateLabel: navigate?.navigateLabel,
    });
  }
  return out;
}

/**
 * `metadata.*` attribute keys promoted onto the strip. The label drops the
 * prefix, which is redundant inside the per-trace context, and the filter icon
 * scopes the table to traces sharing the key and value.
 */
function metadataAutoPins(ctx: PinBuildContext, userKeys: Set<string>): CategorizedPin[] {
  const out: CategorizedPin[] = [];
  const seenMetadataKeys = new Set<string>();
  for (const [key, rawValue] of Object.entries(ctx.trace.attributes)) {
    if (!key.startsWith("metadata.")) continue;
    if (userKeys.has(`attribute:${key}`)) continue;
    if (AUTO_PIN_SUPPRESSED_METADATA_KEYS.has(key)) continue;
    if (seenMetadataKeys.has(key)) continue;
    seenMetadataKeys.add(key);
    const value = formatPinValue({ key, value: rawValue ?? null });
    if (!value) continue;
    const filterQuery = formatMetadataFilterQuery({ key, value });
    out.push({
      pin: { source: "attribute", key, label: key.slice("metadata.".length) },
      value,
      auto: true,
      category: "custom",
      onFilter: filterQuery
        ? () =>
            guardTraceEditExit(() => {
              ctx.applyQueryTextFromPin(filterQuery);
              ctx.closeDrawer();
            })
        : undefined,
    });
  }
  return out;
}

/** The reader's own pins, resolved against the trace or its resource attributes. */
function userPins(ctx: PinBuildContext): CategorizedPin[] {
  return ctx.pins.map((p) => {
    const valueSource = p.source === "resource" ? ctx.resourceAttributes : ctx.trace.attributes;
    const value = formatPinValue({ key: p.key, value: resolveAttributeValue(valueSource, p.key) });
    const filterField = FILTERABLE_PIN_FIELDS[p.key];
    const navigate = value ? pinNavigation({ ctx, key: p.key, value }) : undefined;
    return {
      pin: p,
      value,
      auto: false,
      category: "custom" as PinCategory,
      onFilter:
        filterField && value ? pinFacetFilter({ ctx, field: filterField, value }) : undefined,
      onNavigate: navigate?.onNavigate,
      navigateLabel: navigate?.navigateLabel,
    };
  });
}

/**
 * Auto and user pins resolved into one array with category buckets, so the strip
 * can group them with subtle dividers between identity / run / tag / custom. An
 * auto-pin is skipped when the reader already pinned the same key explicitly, so
 * the same row never shows twice.
 */
function categorizePins(ctx: PinBuildContext): CategorizedPin[] {
  const userKeys = new Set(ctx.pins.map((p) => `${p.source}:${p.key}`));
  return [...hoistedAutoPins(ctx, userKeys), ...metadataAutoPins(ctx, userKeys), ...userPins(ctx)];
}

/**
 * The back button, with the whole navigation stack behind a right-click. Most
 * recent first, so the menu's order matches the direction of "back".
 */
function BackNavigationMenu({
  backStack,
  backStackDepth,
  goBack,
  goBackTo,
}: {
  backStack: ReturnType<typeof useTraceDrawerNavigation>["backStack"];
  backStackDepth: number;
  goBack: () => void;
  goBackTo: (index: number) => void;
}) {
  return (
    <MenuRoot>
      <Tooltip
        content={
          <HStack gap={1}>
            <Text>
              {backStackDepth > 1
                ? `Back (${backStackDepth} traces). Right-click for full history`
                : "Back to previous trace"}
            </Text>
            <Kbd>B</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        <TriggerAnchor>
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
        </TriggerAnchor>
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
                <Text textStyle="xs" flex={1} truncate>
                  {entry.traceId.slice(0, 16)}
                  <Text as="span" textStyle="2xs" color="fg.subtle" marginLeft={2}>
                    {entry.viewMode}
                  </Text>
                </Text>
              </MenuItem>
            );
          })}
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * The drawer's own chrome: share, refresh, maximize, the overflow menu, and
 * close. Every one of these needs a session, so the cluster is unmounted rather
 * than hidden for a share viewer — `display:none` would still run the overflow
 * menu's queries.
 */
function HeaderActions({
  canShare,
  dejaViewHref,
  isMaximized,
  isRefreshing,
  onAddToAnnotationQueue,
  onClose,
  onCopyTraceId,
  onFindSimilar,
  onMaximizeClick,
  onOpenRawJson,
  onRefresh,
  onShare,
  onShowShortcuts,
  onTogglePinned,
  pinned,
  readOnly,
  trace,
}: {
  canShare: boolean;
  dejaViewHref: string | null;
  isMaximized: boolean;
  isRefreshing: boolean;
  onAddToAnnotationQueue: () => void;
  onClose: () => void;
  onCopyTraceId: () => void;
  onFindSimilar: (() => void) | null;
  onMaximizeClick: () => void;
  onOpenRawJson: () => void;
  onRefresh: () => Promise<void> | void;
  onShare: () => void;
  onShowShortcuts: () => void;
  onTogglePinned: () => void;
  pinned: boolean;
  readOnly: boolean;
  trace: TraceHeader;
}) {
  return (
    <HStack gap={1} flexShrink={0} marginRight={-2} marginTop={-2}>
      {canShare && (
        <Tooltip content="Share" positioning={{ placement: "bottom" }}>
          <Button size="xs" variant="ghost" onClick={onShare} aria-label="Share trace">
            <Icon as={LuShare2} boxSize={3.5} />
          </Button>
        </Tooltip>
      )}
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
          onClick={() => void onRefresh()}
          disabled={isRefreshing}
          aria-label="Refresh trace"
          css={
            isRefreshing
              ? {
                  "& svg": {
                    animation: "tracesV2DrawerRefreshSpin 0.9s linear infinite",
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
          onClick={onMaximizeClick}
          aria-label={isMaximized ? "Restore drawer" : "Maximize drawer"}
        >
          <Icon as={isMaximized ? LuMinimize2 : LuMaximize2} boxSize={3.5} />
        </Button>
      </Tooltip>
      <TraceOverflowMenu
        traceId={trace.traceId}
        conversationId={trace.conversationId}
        onCopyTraceId={onCopyTraceId}
        onFindSimilar={onFindSimilar}
        dejaViewHref={dejaViewHref}
        onOpenRawJson={onOpenRawJson}
        onShowShortcuts={onShowShortcuts}
        onAddToAnnotationQueue={onAddToAnnotationQueue}
        pinned={pinned}
        onTogglePinned={onTogglePinned}
        readOnly={readOnly}
      />
      <Box width="1px" height="16px" bg="border.muted" marginX={0.5} flexShrink={0} />
      <Tooltip
        content={
          <HStack gap={1}>
            <Text>Close</Text>
            <Kbd>Esc</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        {/* Plain ghost Button — the standard Chakra `CloseButton`
          (IconButton wrapper) intermittently swallowed the click
          under our Drawer.Root setup: the URL stripped fine but
          the drawer didn't unmount, leaving the operator stuck.
          A bare Button calling `onClose` directly is the same
          pattern this drawer used pre-revamp and behaves
          reliably across Chakra's Drawer focus management. */}
        <Button
          size="xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close drawer"
          paddingX={1.5}
          paddingY={1.5}
          height="auto"
          minWidth="auto"
          color="fg.muted"
          _hover={{ bg: "bg.muted", color: "fg" }}
          _active={{ bg: "bg.emphasized" }}
        >
          <Icon as={LuX} boxSize={4} strokeWidth={2.25} />
        </Button>
      </Tooltip>
    </HStack>
  );
}

/**
 * Performance metrics, pinned context and the source/tools chips in one wrapped
 * strip, so a single row of pills doesn't carry a permanent empty band beneath.
 */
function HeaderMetricsRow({
  billedCost,
  cacheCreation1hTokens,
  cacheCreation5mTokens,
  cacheCreationTokens,
  cacheReadTokens,
  chipsOverflow,
  contextSizeTokens,
  grandCost,
  hasAuthoritativeTokens,
  isBundledCost,
  nonBilledCost,
  primaryChips,
  reasoningEffort,
  reasoningTokens,
  totalTokensWithCache,
  trace,
}: {
  billedCost: number;
  cacheCreation1hTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  chipsOverflow: ReturnType<typeof splitChipsForOverflow>["overflowChip"];
  contextSizeTokens: number | null;
  grandCost: number;
  hasAuthoritativeTokens: boolean;
  isBundledCost: boolean;
  nonBilledCost: number;
  primaryChips: ReturnType<typeof splitChipsForOverflow>["primary"];
  reasoningEffort: string | null;
  reasoningTokens: number | null;
  totalTokensWithCache: number;
  trace: TraceHeader;
}) {
  return (
    <HStack gap={1.5} flexWrap="wrap" align="center" alignContent="flex-start">
      {/* Section 1: Performance metrics */}
      <MetricPill label="Duration" value={formatDuration(trace.durationMs)} />
      {trace.spanCount > 0 && <MetricPill label="Spans" value={trace.spanCount.toLocaleString()} />}
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
      {grandCost > 0 && (
        <Tooltip
          content={
            <CostBreakdownTooltipContent
              isBundled={isBundledCost}
              billedCost={billedCost}
              nonBilledCost={nonBilledCost}
              grandCost={grandCost}
              tokensEstimated={trace.tokensEstimated}
              estimatedNote={trace.tokensEstimated && !hasAuthoritativeTokens}
            />
          }
          positioning={{ placement: "top" }}
        >
          <Box>
            {isBundledCost ? (
              <MetricPill label="Cost" value="Bundled" tone="purple" />
            ) : (
              <MetricPill label="Cost" value={formatCost(billedCost)} />
            )}
          </Box>
        </Tooltip>
      )}
      {contextSizeTokens != null && contextSizeTokens > 0 && (
        <Tooltip
          content="Context carried into this trace's first model call."
          positioning={{ placement: "top" }}
        >
          <Box>
            <MetricPill label="Context size" value={formatTokens(contextSizeTokens)} />
          </Box>
        </Tooltip>
      )}
      {trace.totalTokens > 0 && (
        <Tooltip
          content={
            <TokenBreakdownTooltipContent
              inputTokens={trace.inputTokens}
              outputTokens={trace.outputTokens}
              cacheReadTokens={cacheReadTokens}
              cacheCreationTokens={cacheCreationTokens}
              cacheCreation5mTokens={cacheCreation5mTokens}
              cacheCreation1hTokens={cacheCreation1hTokens}
              reasoningTokens={reasoningTokens}
              totalWithCache={totalTokensWithCache}
              estimated={trace.tokensEstimated && !hasAuthoritativeTokens}
            />
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
      {reasoningTokens != null && reasoningTokens > 0 && (
        <MetricPill label="Reasoning" value={formatTokens(reasoningTokens)} />
      )}
      {trace.models.length > 0 &&
        (trace.models.length > 1 ? (
          // Folded +N (matches the table's model chip) — the count lives
          // inside the pill value rather than as a separate badge; the
          // full model list is one hover away via the tooltip.
          <ModelsTooltip models={trace.models}>
            <Box display="inline-flex">
              <MetricPill
                label="Models"
                value={`${trace.models[0]!}  +${trace.models.length - 1}`}
              />
            </Box>
          </ModelsTooltip>
        ) : (
          <MetricPill label="Model" value={trace.models[0]!} />
        ))}
      {reasoningEffort && <MetricPill label="Reasoning effort" value={reasoningEffort} />}

      {/* Section 2: Source / tools chips (service, origin, scenario, sdk,
          prompts, annotations). Capped at 6 inline; surplus rolls into
          the standard "+N more" popover. No PinDivider before this
          section — the chip borders give enough visual grouping on
          their own, the extra rule just read as a stray line. */}
      {primaryChips.map((c) => (
        <Chip key={c.id} {...c} />
      ))}
      {chipsOverflow}
    </HStack>
  );
}

/**
 * Inline mode tabs — Trace / Conversation. The trace id and its relative
 * timestamp tuck into the right corner of the same row, so they aren't claiming
 * a slot in the chip strip above.
 */
function HeaderModeSwitch({
  conversationContext,
  isEditing,
  onViewModeChange,
  readOnly,
  trace,
  viewMode,
}: {
  conversationContext: ReturnType<typeof useConversationContext>;
  isEditing: boolean;
  onViewModeChange: ReturnType<typeof useDrawerStore.getState>["setViewMode"];
  readOnly: boolean;
  trace: TraceHeader;
  viewMode: ReturnType<typeof useDrawerStore.getState>["viewMode"];
}) {
  return (
    <Box marginX={-4}>
      <ModeSwitch
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        hasConversation={!!trace.conversationId}
        // Conversation mode needs a session (tracesV2.list + annotation
        // reads), so share viewers don't get the tab at all. See ADR-057.
        isConversationHidden={readOnly}
        // `useConversationContext` returns `isLoading: true` while the
        // turns are in flight; combined with `turns.length === 0` it
        // means the conversation hasn't resolved yet. We only want the
        // "loading" gate when a conversationId is declared — otherwise
        // the tab is permanently disabled with a different reason.
        isConversationLoading={
          !!trace.conversationId &&
          conversationContext.isLoading &&
          conversationContext.turns.length === 0
        }
        traceId={trace.traceId}
        // Usage/Terminal ride the session-backed tracesV2 reads, which are
        // protected — share viewers don't get those tabs either.
        showTerminal={
          !readOnly &&
          isTerminalOrigin({
            serviceName: trace.serviceName,
            origin: trace.origin,
          })
        }
        isEditing={isEditing}
        endSlot={
          <HStack gap={2}>
            {/* Switching between the corrected and the captured trace, and
                the full difference between them. Renders nothing until the
                trace actually has a correction. */}
            {!readOnly && <EditedOriginalToggle />}
            {/* Presence avatars sit at the trailing edge of the mode-tab
                row — out of the way of the title and not crowding the
                action cluster. Copy trace ID lives in the overflow
                menu / `Y` shortcut, so the inline chip is gone. */}
            <TracePresenceAvatars traceId={trace.traceId} max={5} size="2xs" />
            <Tooltip
              content={
                <VStack align="start" gap={0.5}>
                  <Text textStyle="xs">
                    First span recorded {formatRelativeTimeAgo(trace.timestamp)}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    {formatAbsoluteTime(trace.timestamp)}
                  </Text>
                </VStack>
              }
              positioning={{ placement: "bottom-end" }}
              openDelay={400}
              closeDelay={150}
              interactive
            >
              <Text textStyle="xs" color="fg.subtle" cursor="help">
                {/* Compact "16d ago" — keeps the unit attached to the
                    number for tight surfaces while still carrying the
                    natural-language "ago" hint. The tooltip resolves
                    the absolute UTC timestamp and is interactive so
                    the user can hover over it and select / copy the
                    date without it disappearing. */}
                {formatRelativeTimeAgo(trace.timestamp)}
              </Text>
            </Tooltip>
          </HStack>
        }
      />
    </Box>
  );
}

/** The dialogs a share viewer has no session to open. */
function SessionOnlyDialogs({
  annotationGate,
  annotationQueueOpen,
  onCloseAnnotationQueue,
  onCloseShare,
  projectId,
  shareOpen,
  traceId,
}: {
  annotationGate: ReturnType<typeof usePersonalFeatureGate>;
  annotationQueueOpen: boolean;
  onCloseAnnotationQueue: () => void;
  onCloseShare: () => void;
  projectId: string | undefined;
  shareOpen: boolean;
  traceId: string;
}) {
  return (
    <>
      <ShareTraceDialog
        open={shareOpen}
        onClose={onCloseShare}
        projectId={projectId}
        traceId={traceId}
      />
      <AddToAnnotationQueueDialog
        open={annotationQueueOpen}
        onClose={onCloseAnnotationQueue}
        traceIds={[traceId]}
      />
      <PersonalFeatureGateDialog state={annotationGate.dialogState} />
    </>
  );
}

/**
 * The row's leading cluster: back navigation, the trace id chip, the title and
 * the status. The chip leads the row and carries only the id, with
 * hover-to-expand and click-to-copy.
 */
function HeaderIdentity({
  backStack,
  backStackDepth,
  canGoBack,
  goBack,
  goBackTo,
  project,
  readOnly,
  statusColor,
  titleIsFallback,
  titleText,
  trace,
}: {
  backStack: ReturnType<typeof useTraceDrawerNavigation>["backStack"];
  backStackDepth: number;
  canGoBack: boolean;
  goBack: () => void;
  goBackTo: (index: number) => void;
  project: ReturnType<typeof useOrganizationTeamProject>["project"];
  readOnly: boolean;
  statusColor: string;
  titleIsFallback: boolean;
  titleText: string;
  trace: TraceHeader;
}) {
  return (
    <HStack gap={2.5} minWidth={0} flex={1} flexWrap="wrap" align="center">
      {canGoBack && !readOnly && (
        <BackNavigationMenu
          backStack={backStack}
          backStackDepth={backStackDepth}
          goBack={goBack}
          goBackTo={goBackTo}
        />
      )}
      <TraceIdChip traceId={trace.traceId} />
      {readOnly || !project ? (
        // Renaming is a mutation; a share viewer has no session to make it,
        // and without a resolved project there is no tenant to make it in.
        <Text
          fontSize="sm"
          fontWeight="600"
          color={titleIsFallback ? "fg.muted" : "fg"}
          lineClamp={1}
        >
          {titleText}
        </Text>
      ) : (
        <EditableTraceName
          projectId={project.id}
          traceId={trace.traceId}
          titleText={titleText}
          titleIsFallback={titleIsFallback}
        />
      )}
      <StatusChip trace={trace} statusColor={statusColor} />
      <SyntheticTraceBadge attributes={trace.attributes} />
    </HStack>
  );
}
