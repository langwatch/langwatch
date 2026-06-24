import {
  Badge,
  Box,
  Button,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type ReactNode, useMemo } from "react";
import {
  LuCircleDashed,
  LuCornerDownRight,
  LuExternalLink,
  LuFileText,
  LuPencil,
  LuTriangleAlert,
} from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { useDrawer } from "~/hooks/useDrawer";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground";
import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { usePromptByHandle } from "../../hooks/usePromptByHandle";
import { useSpansFull } from "../../hooks/useSpansFull";
import { abbreviateModel, formatDuration } from "../../utils/formatters";
import {
  extractPromptReference,
  type PromptReference,
  parseTracePromptIds,
  promptReferenceKey,
} from "../../utils/promptAttributes";

interface PromptsPanelProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  onSelectSpan: (spanId: string) => void;
  /** Suppress the panel's own count header + helper line. Set when the
   *  panel is embedded under a section that already titles it (the trace
   *  summary's "Prompts" accordion), so the heading isn't doubled.
   *
   *  When embedded, the panel renders with no horizontal padding of its
   *  own — the host `Section` already pads content to `paddingX={4}`, so
   *  the cards align flush with every other drawer section. */
  hideHeader?: boolean;
}

interface PromptUsage {
  ref: PromptReference;
  /** Span IDs that referenced this prompt. */
  spanIds: string[];
  /** Variable values (latest seen per key, since spans may share vars). */
  variables: Record<string, string>;
}

/**
 * Aggregates spans by their prompt reference. Falls back to the trace-level
 * `langwatch.prompt_ids` summary when full span data hasn't loaded yet so
 * the panel always shows *which* prompts ran, even before variables stream
 * in.
 */
function aggregatePromptUsage(
  spansFull: SpanDetail[] | undefined,
  fallbackRefs: PromptReference[],
): PromptUsage[] {
  if (!spansFull || spansFull.length === 0) {
    return fallbackRefs.map((ref) => ({ ref, spanIds: [], variables: {} }));
  }

  const byKey = new Map<string, PromptUsage>();
  // Index span-derived usages by handle alone too, so a fallback ref with
  // no version (e.g. `"handle:latest"` from `langwatch.prompt_ids`) can
  // still match against spans on that handle even when version numbers
  // differ. Without this, the panel rendered every fallback card with
  // empty span lists and a bogus "still loading" message.
  const byHandle = new Map<string, PromptUsage[]>();
  for (const span of spansFull) {
    const ref = extractPromptReference(span.params);
    if (!ref) continue;
    const key = promptReferenceKey(ref);
    let usage = byKey.get(key);
    if (!usage) {
      usage = { ref, spanIds: [], variables: {} };
      byKey.set(key, usage);
      const list = byHandle.get(ref.handle) ?? [];
      list.push(usage);
      byHandle.set(ref.handle, list);
    }
    usage.spanIds.push(span.spanId);
    if (ref.variables) {
      for (const [k, v] of Object.entries(ref.variables)) {
        usage.variables[k] = v;
      }
    }
    // Propagate draft=true forward. The flag lives on Prompt.compile
    // but the first span we see for a given prompt may be the
    // sibling PromptApiService.get which doesn't carry it — without
    // this merge the usage.ref.draft would be locked to the get
    // span's `false` and the "unsaved edits" chip never renders.
    if (ref.draft && !usage.ref.draft) {
      usage.ref = { ...usage.ref, draft: true };
    }
  }

  const ordered: PromptUsage[] = [];
  const seen = new Set<string>();
  for (const ref of fallbackRefs) {
    const key = promptReferenceKey(ref);
    const exact = byKey.get(key);
    if (exact) {
      ordered.push(exact);
      seen.add(key);
      continue;
    }
    // Permissive match: when the fallback ref doesn't pin a version, fall
    // back to handle-only and prefer the first span-derived usage for that
    // handle. Keeps a single ordered card per fallback entry rather than
    // surfacing both an empty fallback card AND a populated extras card.
    if (ref.versionNumber == null && !ref.tag) {
      const candidates = byHandle.get(ref.handle);
      if (candidates && candidates.length > 0) {
        const usage = candidates[0]!;
        ordered.push(usage);
        seen.add(promptReferenceKey(usage.ref));
        continue;
      }
    }
    ordered.push({ ref, spanIds: [], variables: {} });
    seen.add(key);
  }
  for (const [key, usage] of byKey) {
    if (!seen.has(key)) ordered.push(usage);
  }
  return ordered;
}

/** Which trace-level role a card plays, when more than one prompt ran. */
type PromptRole = "pinned" | "lastUsed";

export function PromptsPanel({
  trace,
  spans,
  onSelectSpan,
  hideHeader = false,
}: PromptsPanelProps) {
  const { openDrawer } = useDrawer();
  const onOpenPromptEditor = (handle: string) => {
    openDrawer("promptEditor", { promptId: handle });
  };

  const fallbackRefs = useMemo(
    () => parseTracePromptIds(trace.attributes),
    [trace.attributes],
  );

  const { data: spansFull, isLoading } = useSpansFull(true);

  const usages = useMemo(
    () => aggregatePromptUsage(spansFull, fallbackRefs),
    [spansFull, fallbackRefs],
  );

  const spanNameById = useMemo(() => {
    const map = new Map<string, SpanTreeNode>();
    for (const s of spans) map.set(s.spanId, s);
    return map;
  }, [spans]);

  if (usages.length === 0 && !trace.containsPrompt) {
    return (
      <VStack align="stretch" gap={1} paddingY={2}>
        <Text textStyle="sm" fontWeight="semibold">
          No prompts in this trace
        </Text>
        <Text textStyle="xs" color="fg.muted">
          Spans on this trace did not reference a managed prompt.
        </Text>
      </VStack>
    );
  }

  // Drift = the pinned (selected) prompt resolved to a different concrete
  // prompt at runtime. Only meaningful when both are present.
  const hasDrift =
    !!trace.selectedPromptId &&
    !!trace.lastUsedPromptId &&
    trace.selectedPromptId !== trace.lastUsedPromptId;

  // Only disambiguate which prompt was pinned vs. last ran when there's
  // more than one card — a single prompt is obviously the one that ran, so
  // a "last used" chip there is just noise. The selected/last-used identity
  // used to render as its own callout block above the cards, which simply
  // duplicated whichever card it pointed at; folding it into an inline chip
  // removes that repetition.
  const showRoleChips = usages.length > 1;
  const roleFor = (handle: string): PromptRole | null => {
    if (!showRoleChips) return null;
    if (trace.lastUsedPromptId && handle === trace.lastUsedPromptId)
      return "lastUsed";
    if (trace.selectedPromptId && handle === trace.selectedPromptId)
      return "pinned";
    return null;
  };

  return (
    <VStack align="stretch" gap={0}>
      {!hideHeader && (
        <Box
          paddingX={4}
          paddingY={3}
          borderBottomWidth="1px"
          borderColor="border"
        >
          <HStack gap={2}>
            <Icon as={LuFileText} boxSize={4} color="blue.fg" />
            <Text textStyle="sm" fontWeight="semibold">
              {usages.length} prompt{usages.length === 1 ? "" : "s"} in this
              trace
            </Text>
          </HStack>
        </Box>
      )}

      {/* Only surfaces when the pin drifted, the trace ran a stale version,
          or the prompt was since deleted — the plain "this is what ran"
          identity now lives as an inline chip on the matching card. */}
      {(trace.selectedPromptId || trace.lastUsedPromptId) && (
        <PromptDriftBanner trace={trace} hasDrift={hasDrift} />
      )}

      <VStack align="stretch" gap={0} divideY="1px" divideColor="border.muted">
        {usages.map((usage) => (
          <PromptUsageCard
            key={promptReferenceKey(usage.ref)}
            usage={usage}
            role={roleFor(usage.ref.handle)}
            spanNameById={spanNameById}
            isLoadingSpans={isLoading && usage.spanIds.length === 0}
            onSelectSpan={onSelectSpan}
            onOpenPromptEditor={onOpenPromptEditor}
          />
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * Renders only when something is actually wrong: the pinned prompt drifted
 * from what ran, the trace ran an out-of-date version, or the managed prompt
 * has since been deleted. Returns null in the common healthy case so the
 * panel leads straight with the prompt cards.
 */
function PromptDriftBanner({
  trace,
  hasDrift,
}: {
  trace: TraceHeader;
  hasDrift: boolean;
}) {
  // Look up the latest version of the last-used prompt to detect
  // out-of-date traces — when the prompt has moved on since this trace
  // ran. Falls quietly to no-warning when the lookup errors.
  const { latestVersion, missing: promptMissing } = usePromptByHandle(
    trace.lastUsedPromptId,
  );
  const outOfDate =
    !!trace.lastUsedPromptVersionNumber &&
    !!latestVersion &&
    latestVersion > trace.lastUsedPromptVersionNumber;

  if (!hasDrift && !outOfDate && !promptMissing) return null;

  const banner = hasDrift || outOfDate ? "yellow.solid/6" : "bg.muted";

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingY={3}
      marginBottom={1}
      borderBottomWidth="1px"
      borderColor="border"
      bg={banner}
    >
      {hasDrift && (
        <WarningRow tone="warning" title="Pinned prompt drifted at runtime">
          The pin resolved to a different concrete prompt than what was recorded
          as last used. Common when a tag like{" "}
          <Text as="span" fontWeight="medium" color="fg">
            production
          </Text>{" "}
          moves between deploys.
        </WarningRow>
      )}

      {outOfDate && latestVersion != null && (
        <WarningRow tone="warning" title="Trace ran an out-of-date prompt">
          This trace used v{trace.lastUsedPromptVersionNumber}; the
          prompt&rsquo;s current latest is v{latestVersion}. Consider re-testing
          against the latest version before relying on this behaviour.
        </WarningRow>
      )}

      {promptMissing && (
        <WarningRow
          tone="muted"
          title="Prompt no longer exists in this project"
        >
          The trace still shows what ran at the time, but the underlying managed
          prompt has been deleted.
        </WarningRow>
      )}
    </VStack>
  );
}

function WarningRow({
  tone,
  title,
  children,
}: {
  tone: "warning" | "muted";
  title: string;
  children: ReactNode;
}) {
  const color = tone === "warning" ? "yellow.fg" : "fg.muted";
  const icon = tone === "warning" ? LuTriangleAlert : LuCircleDashed;
  return (
    <HStack gap={2} align="flex-start">
      <Icon
        as={icon}
        boxSize={3.5}
        color={color}
        marginTop="2px"
        flexShrink={0}
      />
      <VStack align="stretch" gap={0.5}>
        <Text textStyle="xs" fontWeight="semibold" color={color}>
          {title}
        </Text>
        <Text textStyle="2xs" color="fg.muted">
          {children}
        </Text>
      </VStack>
    </HStack>
  );
}

function PromptRoleChip({ role }: { role: PromptRole }) {
  return (
    <Badge
      size="sm"
      variant="surface"
      colorPalette={role === "pinned" ? "blue" : "purple"}
    >
      {role === "pinned" ? "pinned" : "last used"}
    </Badge>
  );
}

function PromptUsageCard({
  usage,
  role,
  spanNameById,
  isLoadingSpans,
  onSelectSpan,
  onOpenPromptEditor,
}: {
  usage: PromptUsage;
  role: PromptRole | null;
  spanNameById: Map<string, SpanTreeNode>;
  isLoadingSpans: boolean;
  onSelectSpan: (spanId: string) => void;
  onOpenPromptEditor: (handle: string) => void;
}) {
  const { ref, spanIds, variables } = usage;
  const variableEntries = Object.entries(variables).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();
  // Prefer the first emitting span (Prompt.compile / PromptApiService.get)
  // — the server-side playground loader walks descendants/siblings to
  // find the actual llm call for it.
  const playgroundSpanId = spanIds[0] ?? null;
  const playgroundHref = playgroundSpanId
    ? (buildUrl(playgroundSpanId)?.toString() ?? "")
    : "";

  return (
    <VStack align="stretch" gap={2.5} paddingY={3}>
      <HStack justify="space-between" gap={2} align="center">
        <HStack gap={2} minWidth={0}>
          <Icon
            as={LuFileText}
            boxSize={3.5}
            color="fg.subtle"
            flexShrink={0}
          />
          <Text textStyle="sm" fontWeight="semibold" truncate minWidth={0}>
            {ref.handle}
          </Text>
          {ref.versionNumber != null && (
            <Badge size="sm" variant="subtle" colorPalette="blue">
              v{ref.versionNumber}
            </Badge>
          )}
          {ref.tag && (
            <Badge size="sm" variant="outline" colorPalette="blue">
              {ref.tag}
            </Badge>
          )}
          {ref.draft && (
            // Executed config diverged from the saved version (user
            // edited inline without saving). Amber chip so operators
            // know "Open prompt" lands on the base version, not the
            // diverged messages in the trace. Mirrors the same chip
            // in PromptAccordion.tsx — kept in sync for parity across
            // the two prompt-surfacing components in the drawer.
            <Badge size="sm" variant="subtle" colorPalette="orange">
              unsaved edits
            </Badge>
          )}
          {role && <PromptRoleChip role={role} />}
        </HStack>
        <HStack gap={0.5} flexShrink={0}>
          <Button
            size="xs"
            variant="ghost"
            color="fg.subtle"
            gap={1}
            onClick={() => onOpenPromptEditor(ref.handle)}
          >
            <Icon as={LuPencil} boxSize={3} />
            Open prompt
          </Button>
          {playgroundHref && (
            <Link href={playgroundHref} isExternal variant="plain">
              <Button size="xs" variant="ghost" color="fg.subtle" gap={1}>
                <Icon as={LuExternalLink} boxSize={3} />
                Playground
              </Button>
            </Link>
          )}
        </HStack>
      </HStack>

      {variableEntries.length > 0 && (
        <Box bg="bg.subtle" borderRadius="md" overflow="hidden">
          {variableEntries.map(([key, val]) => (
            <HStack
              key={key}
              paddingX={2.5}
              paddingY={1}
              gap={3}
              align="center"
            >
              <Text
                width="120px"
                flexShrink={0}
                textStyle="xs"
                fontFamily="mono"
                color="fg.muted"
                truncate
                title={key}
              >
                {key}
              </Text>
              <Text
                flex={1}
                textStyle="xs"
                color="fg"
                truncate
                minWidth={0}
                title={val}
              >
                {val}
              </Text>
            </HStack>
          ))}
        </Box>
      )}

      {isLoadingSpans ? (
        <VStack align="stretch" gap={1}>
          <Skeleton height="20px" />
          <Skeleton height="20px" width="70%" />
        </VStack>
      ) : spanIds.length === 0 ? (
        <Text textStyle="xs" color="fg.subtle">
          Recorded from trace attributes; no span on this trace exposes the
          prompt id directly.
        </Text>
      ) : (
        <VStack align="stretch" gap={0}>
          {spanIds.map((spanId) => (
            <SpanRow
              key={spanId}
              spanId={spanId}
              span={spanNameById.get(spanId) ?? null}
              onClick={() => onSelectSpan(spanId)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function SpanRow({
  spanId,
  span,
  onClick,
}: {
  spanId: string;
  span: SpanTreeNode | null;
  onClick: () => void;
}) {
  return (
    <HStack
      as="button"
      onClick={onClick}
      gap={2}
      paddingX={1.5}
      paddingY={1}
      borderRadius="sm"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      align="center"
      width="full"
      textAlign="left"
    >
      <Icon
        as={LuCornerDownRight}
        boxSize={3}
        color="fg.subtle"
        flexShrink={0}
      />
      <Text textStyle="xs" color="fg" truncate flex={1} minWidth={0}>
        {span?.name ?? spanId}
      </Text>
      {span?.model && (
        <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
          {abbreviateModel(span.model)}
        </Text>
      )}
      {span && (
        <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
          {formatDuration(span.durationMs)}
        </Text>
      )}
    </HStack>
  );
}
