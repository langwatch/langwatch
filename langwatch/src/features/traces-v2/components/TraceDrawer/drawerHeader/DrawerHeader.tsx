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
  LuX,
} from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import {
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuRoot,
} from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useConversationContext } from "../../../hooks/useConversationContext";
import { usePinnedAttributes } from "../../../hooks/usePinnedAttributes";
import { useTraceDrawerNavigation } from "../../../hooks/useTraceDrawerNavigation";
import { useSpanTree } from "../../../hooks/useSpanTree";
import { useTraceHeader } from "../../../hooks/useTraceHeader";
import { useTraceRefresh } from "../../../hooks/useTraceRefresh";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { useDrawerStore } from "../../../stores/drawerStore";
import { useFilterStore } from "../../../stores/filterStore";
import { useFocusSectionStore } from "../../../stores/focusSectionStore";
import { rankedErrorSpans } from "../../../utils/errorSpans";
import { ExceptionsContent } from "../ExceptionsContent";
import { ExtraModelsBadge } from "../../TraceTable/registry/cells/trace/ModelCell";
import type { PinnedAttribute } from "../../../stores/pinnedAttributesStore";
import {
  abbreviateModel,
  formatAbsoluteTime,
  formatCost,
  formatDuration,
  formatRelativeTimeAgo,
  formatTokens,
  SPAN_TYPE_COLORS,
  STATUS_COLORS,
} from "../../../utils/formatters";
import { Chip } from "../Chip";
import { CostBreakdownTooltipContent } from "../../shared/CostBreakdownTooltip";
import { TokenBreakdownTooltipContent } from "../../shared/TokenBreakdownTooltip";
import { TooltipRow } from "../../shared/TooltipRow";
import { splitChipsForOverflow } from "../ChipBar";
import { ModeSwitch } from "../ModeSwitch";
import { RawJsonDialog } from "../RawJsonDialog";
import { useTraceHeaderChipDefs } from "../TraceHeaderChips";
import { EditableTraceName } from "./EditableTraceName";
import { MetricPill } from "./MetricPill";
import {
  type CategorizedPin,
  type PinCategory,
  PinDivider,
  renderPinPills,
} from "./PinStrip";
import { ThreadProgressIndicator } from "./ThreadProgressIndicator";
import { TraceOverflowMenu } from "./TraceOverflowMenu";
import {
  formatPinValue,
  readNumberAttribute,
  resolveAttributeValue,
} from "./utils";

interface DrawerHeaderProps {
  trace: TraceHeader;
  /** Parent's drawer-close handler (URL teardown). */
  onClose: () => void;
}

/**
 * Inline trace ID chip — collapsed to the first 5 chars by default so
 * it doesn't compete with the trace name, expands to the full ID on
 * hover, and reveals a copy icon at the trailing edge. Power-users can
 * still hit `Y` (overflow-menu shortcut) to copy without hovering;
 * this is for the case where they want to read the ID without leaving
 * the header.
 */
/**
 * Trace ID chip rendered with the same Chip component the metric pills
 * use (Duration / Spans / Cost / …) so the drawer header reads as one
 * consistent strip rather than the trace ID floating with its own
 * styling. 8 chars short by default — git's short-SHA convention, long
 * enough to be uniquely scannable but still fits beside the trace name.
 * On hover the short id swaps to the full id and a copy icon appears;
 * clicking anywhere on the chip copies to the clipboard.
 */
function TraceIdChip({ traceId }: { traceId: string }) {
  const short = traceId.slice(0, 8);
  const handleCopy = async () => {
    // navigator.clipboard requires a secure context (https or localhost).
    // Surface a friendly hint when it fails so users running LangWatch on
    // a plain-http internal domain understand what went wrong instead of
    // seeing a silent no-op.
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
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
      toaster.create({
        title: "Couldn't copy trace ID",
        description:
          "Clipboard access is restricted. This can happen on non-HTTPS domains. Copy the ID manually from the URL.",
        type: "error",
        duration: 6000,
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
      <Text
        as="span"
        data-expanded
        textStyle="xs"
        color="fg"
        fontWeight="medium"
        display="none"
      >
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
 * Trace status indicator. On error traces the chip is an interactive
 * popover: hovering opens an inline preview of the Exceptions section
 * (same trace-level message + same per-span pill row, sourced from
 * the same `rankedErrorSpans` helper), and clicking the chip itself
 * jumps the operator to the Summary tab's Exceptions accordion with
 * a brief blue pulse so the eye lands. OK traces render the dot
 * non-interactively (just the help tooltip).
 */
function StatusChip({
  trace,
  statusColor,
}: {
  trace: TraceHeader;
  statusColor: string;
}) {
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const requestFocus = useFocusSectionStore((s) => s.request);
  const spanTree = useSpanTree();
  const errorSpans = useMemo(
    () => rankedErrorSpans(spanTree.data ?? []),
    [spanTree.data],
  );

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
      // Land on the trace pane with the span selected. `setViewMode`
      // flips the drawer to the trace-pane layout (PaneLayout); the
      // SpanDetailPane mounts because `selectedSpanId` is now set, and
      // the SpanTabBar highlights the selected span. The accordion-side
      // focus-glow observer on SpanAccordions catches the follow-up
      // `requestFocus({section: "exceptions"})` fired by
      // ExceptionsContent and pulses the span's own Exceptions section.
      //
      // When the spanTree query is still in flight we'd previously fall
      // through to the trace summary view; TraceAccordions now renders
      // a span-shaped skeleton in that window so the jump reads as
      // "landed, waiting for data" rather than "jump didn't take."
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
      <Text
        textStyle="xs"
        fontWeight="medium"
        color={statusColor}
        textTransform="capitalize"
      >
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
 * Liqe field names are bare identifiers — letters, digits, dots,
 * underscores, dashes. Customer-defined metadata keys come from
 * arbitrary OTLP attributes, so a malicious or careless key can contain
 * spaces, quotes, colons, parens, etc. Injecting an unsafe key as a raw
 * field name breaks the grammar (the query becomes unparsable, or
 * worse, targets the wrong field). We restrict to a safe whitelist and
 * disable the filter affordance when the key can't round-trip.
 */
const SAFE_METADATA_KEY_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Build a Liqe-style fielded query for an auto-pinned metadata value.
 * Escapes embedded quotes + backslashes in the value so things like
 * `tenant="org \"acme\""` stay parseable. Returns null when either the
 * key can't be safely round-tripped as a bare Liqe field, or the value
 * collapses to empty after escape.
 */
function formatMetadataFilterQuery(
  key: string,
  value: string,
): string | null {
  if (!SAFE_METADATA_KEY_RE.test(key)) return null;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!escaped) return null;
  return `${key}:"${escaped}"`;
}

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
  const pinned = useDrawerStore((s) => s.pinned);
  const togglePinned = useDrawerStore((s) => s.togglePinned);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
  const toggleSnapMaximize = useDrawerStore((s) => s.toggleSnapMaximize);
  // The Maximize / Restore icon drives the same width snap that
  // double-clicking the edge grip uses — `widthPx` is the actual size
  // signal, while the boolean `isMaximized` is kept in sync for
  // components that read it to swap the icon label. The SSR / no-window
  // branch falls through to `toggleMaximized()` so the button still
  // does *something* visible during hydration.
  const handleMaximizeClick = () => {
    if (typeof window === "undefined") {
      toggleMaximized();
      return;
    }
    toggleSnapMaximize(window.innerWidth);
  };
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

  // Cache + reasoning are summed across the trace's spans by the fold and
  // parked on reserved keys (the raw per-span gen_ai.usage.cache_* values
  // never reach the trace attribute map). Read the reserved sums first and
  // fall back to the raw keys for traces folded before the sum landed.
  const cacheReadTokens = readNumberAttribute(
    trace.attributes,
    "langwatch.reserved.cache_read_tokens",
    "gen_ai.usage.cache_read.input_tokens",
    "gen_ai.usage.cached_tokens",
  );
  const cacheCreationTokens = readNumberAttribute(
    trace.attributes,
    "langwatch.reserved.cache_creation_tokens",
    "gen_ai.usage.cache_creation.input_tokens",
  );
  const reasoningTokens = readNumberAttribute(
    trace.attributes,
    "langwatch.reserved.reasoning_tokens",
    "gen_ai.usage.reasoning_tokens",
  );

  // The reasoning EFFORT request setting (low/medium/high/...), lifted onto
  // the trace summary by the fold. Distinct from the reasoning TOKEN count
  // above; shown next to the model since it is a per-request model setting.
  const reasoningEffort =
    trace.attributes?.["gen_ai.request.reasoning_effort"]?.trim() ?? null;

  // Total tokens the model actually processed = input + output PLUS cache
  // read + cache write. Anthropic reports `input_tokens` as the NON-cached
  // portion, so the cache counts are additive, not a subset (which is why a
  // raw input+output "Total" can sit below the cache rows and read as wrong).
  // Reasoning is a subset of output, so it is not added again. Falls back to
  // the server input+output total when no cache was reported.
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
  const conversationContext = useConversationContext(
    trace.conversationId ?? null,
    trace.traceId,
  );
  const { pins, removePin } = usePinnedAttributes(project?.id);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  // `applyQueryTextFromPin` is used by the auto-pinned metadata filter
  // affordance below. Pulled at the parent scope so the `useMemo` for
  // `categorizedPins` doesn't need to re-subscribe to the store on every
  // pin shape change.
  const applyQueryTextFromPin = useFilterStore((s) => s.applyQueryText);
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
              // Prompts is no longer a separate tab — SpanDetailPane
              // auto-renders the PromptsPanel when the selected span has
              // prompt data. So all we do here is select the span and
              // the right panel adapts.
              const spanId =
                key === "langwatch.prompt.selected"
                  ? trace.selectedPromptSpanId
                  : trace.lastUsedPromptSpanId;
              if (spanId) selectSpan(spanId);
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
      // The rich `Scenario run` chip (built from `useScenarioChipData`
      // in `TraceHeaderChips`) already surfaces the scenario run id with
      // status + criteria + click-to-open behaviour. The plain hoisted
      // pin would render the bare run id next to it, producing two pills
      // for the same concept — so we skip the hoisted version whenever a
      // scenario run is attached to the trace.
      if (
        def.key === "scenario.run_id" &&
        (trace.scenarioRunId ?? trace.attributes["scenario.run_id"])
      ) {
        continue;
      }
      if (userKeys.has(`attribute:${def.key}`)) continue;
      const resolved = def.resolve
        ? def.resolve(trace)
        : trace.attributes[def.key];
      const value = formatPinValue({ key: def.key, value: resolved ?? null });
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

    // Auto-promote `metadata.*` attribute keys onto the pin strip. This is
    // the customer-defined metadata namespace (langwatch reserved keys
    // like `metadata.user_id`, `metadata.thread_id`, plus anything the
    // caller attached via the SDK's metadata field). These are exactly
    // the fields observability-first users want to see at the top of the
    // drawer without having to dig into the Metadata accordion — they're
    // also (by definition) safe to surface because the customer chose to
    // emit them as semantic context rather than as raw OTel attributes.
    //
    // They land in the `custom` category so they share the inline cap
    // (MAX_INLINE_PINS) with user-pinned attributes; remaining ones still
    // spill into the "+N pinned" popover instead of blowing out the strip
    // for a trace that happens to carry 50 metadata keys.
    const seenMetadataKeys = new Set<string>();
    for (const [key, rawValue] of Object.entries(trace.attributes)) {
      if (!key.startsWith("metadata.")) continue;
      if (userKeys.has(`attribute:${key}`)) continue;
      if (seenMetadataKeys.has(key)) continue;
      seenMetadataKeys.add(key);
      const value = formatPinValue({ key, value: rawValue ?? null });
      if (!value) continue;
      // Label strips the `metadata.` prefix for readability — the strip
      // is dense and the prefix is redundant inside the per-trace context.
      const label = key.slice("metadata.".length);
      // Auto-pinned metadata pins gain a filter affordance: clicking the
      // filter icon scopes the trace table to traces that share this
      // attribute key/value. We inject a Liqe-style fielded query
      // through `applyQueryText` because there's no first-class facet
      // for arbitrary `metadata.*` keys today — Liqe accepts unknown
      // field names and the backend's text search treats them as
      // attribute-key filters (same behaviour the search bar uses for
      // hand-typed `metadata.tenant:"org-acme"` queries).
      const filterQuery = formatMetadataFilterQuery(key, value);
      out.push({
        pin: { source: "attribute", key, label },
        value,
        auto: true,
        category: "custom",
        onFilter: filterQuery
          ? () => {
              applyQueryTextFromPin(filterQuery);
              closeDrawer();
            }
          : undefined,
      });
    }

    for (const p of pins) {
      const valueSource =
        p.source === "resource"
          ? resources.resourceAttributes
          : trace.attributes;
      const value = formatPinValue({
        key: p.key,
        value: resolveAttributeValue(valueSource, p.key),
      });
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
    applyQueryTextFromPin,
    closeDrawer,
    openDrawer,
    setViewMode,
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
    if (trace.traceName) {
      const escaped = trace.traceName
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      parts.push(`"${escaped}"`);
    }
    return parts.join(" ");
  }, [trace.serviceName, trace.status, trace.traceName]);
  const handleFindSimilar = useCallback(() => {
    if (!findSimilarQuery) return;
    applyQueryText(findSimilarQuery);
    closeDrawer();
  }, [applyQueryText, closeDrawer, findSimilarQuery]);

  const { refresh: handleRefresh, isRefreshing } = useTraceRefresh(
    trace.traceId,
  );

  // Title fallback chain: explicit traceName attribute → root span name (the
  // server populates `trace.name` from it) → trace ID prefix as a last
  // resort. The fallback is rendered muted so the reader can tell at a
  // glance that no semantic name was set rather than reading the ID hex
  // as if it were the title. We detect the ID-fallback case by comparing
  // against a prefix of the trace ID — server-side projection drops the
  // span name into `trace.name` for unnamed traces, but for traces with
  // no spans at all the same field falls through to the trace ID itself.
  const { titleText, titleIsFallback } = useMemo(() => {
    const explicit = trace.traceName?.trim();
    if (explicit) return { titleText: explicit, titleIsFallback: false };
    const spanName = trace.name?.trim();
    if (
      spanName &&
      spanName !== trace.traceId &&
      !trace.traceId.startsWith(spanName)
    ) {
      return { titleText: spanName, titleIsFallback: false };
    }
    return {
      titleText: trace.traceId.slice(0, 12),
      titleIsFallback: true,
    };
  }, [trace.traceName, trace.name, trace.traceId]);

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
  const { primary: primaryChips, overflowChip: chipsOverflow } =
    splitChipsForOverflow(chipDefs, 10);
  // Pins: auto-pins (identity/run/tag) always inline. Custom + metadata
  // pins inline up to MAX_INLINE_PINS — the rest still spill into the
  // overflow popover so a pathological 200-pin trace can't blow out the
  // header. The strip itself already wraps to multiple rows
  // (`flexWrap="wrap"` on the HStack below), so a cap of 12 lets typical
  // metadata-heavy traces breathe across 2-3 wrapped rows without
  // hiding anything the user expected to see.
  //
  // Previous behaviour was a cap of 3 with overflow — which the customer
  // (Trace Explorer power user) called out specifically: pinning 5
  // metadata fields left them looking at three pills plus a "+2 pinned"
  // chip, with no indication of what they'd asked to see.
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
        <HStack gap={2.5} minWidth={0} flex={1} flexWrap="wrap" align="center">
          {canGoBack && (
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
          <TraceIdChip traceId={trace.traceId} />
          <EditableTraceName
            traceId={trace.traceId}
            titleText={titleText}
            titleIsFallback={titleIsFallback}
          />
          <StatusChip trace={trace} statusColor={statusColor} />
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

        {/* Negative marginRight cancels the header's paddingX so the
            close button sits flush with the drawer edge, matching the
            online-evaluations / add-to-dataset drawers (their
            DrawerCloseTrigger uses absolute positioning at the edge).
            marginTop matches what the other drawers do — their close
            button sits ~8px from the top of the drawer chrome, the
            VStack's paddingTop={3} (12px) puts ours too low without
            this offset. */}
        <HStack gap={1} flexShrink={0} marginRight={-2} marginTop={-2}>
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
              onClick={handleMaximizeClick}
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
            pinned={pinned}
            onTogglePinned={togglePinned}
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
      </HStack>

      {/* Row 2: Unified context strip. Three logical sections — performance
          metrics, pinned context, source/tools chips — flow into one wrapped
          row separated by thin vertical dividers. The right end slot anchors
          the trace ID + relative timestamp. Collapsing what used to be three
          separate rows keeps the header dense without losing categorisation.
          The strip wraps naturally — height tracks content rather than
          locking to two rows, so traces with a single row of pills don't
          carry a permanent ~28px empty band underneath. */}
      <HStack
        gap={1.5}
        flexWrap="wrap"
        align="center"
        alignContent="flex-start"
      >
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
        {trace.totalTokens > 0 && (
          <Tooltip
            content={
              <TokenBreakdownTooltipContent
                inputTokens={trace.inputTokens}
                outputTokens={trace.outputTokens}
                cacheReadTokens={cacheReadTokens}
                cacheCreationTokens={cacheCreationTokens}
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
        {trace.models.length > 0 && (
          <HStack gap={1}>
            <MetricPill
              label={trace.models.length > 1 ? "Models" : "Model"}
              value={abbreviateModel(trace.models[0]!)}
            />
            {trace.models.length > 1 && (
              <ExtraModelsBadge models={trace.models.slice(1)} size="sm" />
            )}
          </HStack>
        )}
        {reasoningEffort && (
          <MetricPill label="Reasoning effort" value={reasoningEffort} />
        )}

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

      {/* Pin strip — auto-pins (identity / run / tag) inline with intra-
          category dividers, custom pins capped at 3 inline with the rest in
          a "+N pinned" overflow popover. The row only renders when there's
          actually something to show; ~35% of traces have no auto-pins (LLM
          completions without a conversation thread, error traces, etc.) and
          the previous always-reserved 28px slot read as dead chrome. The
          height jump on next/previous-trace nav between trace-with-pins and
          trace-without is small enough (~28px) that it's cheaper than the
          permanent waste. */}
      {(pinResult.inline.length > 0 || pinResult.overflow != null) && (
        <HStack
          gap={1.5}
          flexWrap="wrap"
          align="center"
          alignContent="flex-start"
        >
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
          // `useConversationContext` returns `isLoading: true` while the
          // turns are in flight; combined with `turns.length === 0` it
          // means the conversation hasn't resolved yet. We only want the
          // "loading" gate when a conversationId is declared — otherwise
          // the tab is permanently disabled with a different reason.
          conversationLoading={
            !!trace.conversationId &&
            conversationContext.isLoading &&
            conversationContext.turns.length === 0
          }
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
              <Tooltip
                content={
                  <VStack align="start" gap={0.5}>
                    <Text textStyle="xs">
                      First span recorded{" "}
                      {formatRelativeTimeAgo(trace.timestamp)}
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
      <RawJsonDialog
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        trace={trace}
      />
    </VStack>
  );
});
