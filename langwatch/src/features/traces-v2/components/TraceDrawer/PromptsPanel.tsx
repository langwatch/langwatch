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
import { useMemo } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import {
  LuArrowRight,
  LuCircleCheck,
  LuCircleDashed,
  LuExternalLink,
  LuFileText,
  LuSparkles,
  LuTriangleAlert,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { Tooltip } from "~/components/ui/tooltip";
import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import {
  extractPromptReference,
  formatPromptReferenceLabel,
  parseTracePromptIds,
  promptReferenceKey,
  type PromptReference,
} from "../../utils/promptAttributes";
import { abbreviateModel, formatDuration } from "../../utils/formatters";

interface PromptsPanelProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  onSelectSpan: (spanId: string) => void;
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

export function PromptsPanel({ trace, spans, onSelectSpan }: PromptsPanelProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const onOpenPromptEditor = (handle: string) => {
    openDrawer("promptEditor", { promptId: handle });
  };

  const fallbackRefs = useMemo(
    () => parseTracePromptIds(trace.attributes),
    [trace.attributes],
  );

  const { data: spansFull, isLoading } = api.tracesV2.spansFull.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: trace.traceId,
    },
    {
      enabled: !!project?.id && !!trace.traceId,
      staleTime: 60_000,
    },
  );

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
      <VStack align="stretch" gap={2} padding={6}>
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

  return (
    <VStack align="stretch" gap={0}>
      <Box
        paddingX={4}
        paddingY={3}
        borderBottomWidth="1px"
        borderColor="border"
      >
        <HStack gap={2}>
          <Icon as={LuFileText} boxSize={4} color="blue.fg" />
          <Text textStyle="sm" fontWeight="semibold">
            {usages.length} prompt{usages.length === 1 ? "" : "s"} in this trace
          </Text>
        </HStack>
        <Text textStyle="xs" color="fg.muted" marginTop={1}>
          Selected = what you pinned · Last used = what actually ran. Click a
          span to focus it in the trace.
        </Text>
      </Box>

      {/* Selected / Last-used callouts. PRD-023 surfaces both as projected
          columns on the trace summary, with their source SpanIds, so the
          drawer can deep-link without re-walking spans. */}
      {(trace.selectedPromptId || trace.lastUsedPromptId) && (
        <SelectedVsLastUsedCallout
          trace={trace}
          hasDrift={hasDrift}
          onSelectSpan={onSelectSpan}
        />
      )}

      <VStack align="stretch" gap={0} divideY="1px" divideColor="border.muted">
        {usages.map((usage) => (
          <PromptUsageCard
            key={promptReferenceKey(usage.ref)}
            usage={usage}
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

function SelectedVsLastUsedCallout({
  trace,
  hasDrift,
  onSelectSpan,
}: {
  trace: TraceHeader;
  hasDrift: boolean;
  onSelectSpan: (spanId: string) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const sameRef =
    !!trace.selectedPromptId &&
    trace.selectedPromptId === trace.lastUsedPromptId;

  // Look up the latest version of the last-used prompt to detect
  // out-of-date traces — when the prompt has moved on since this trace
  // ran. Falls quietly to no-warning when the lookup errors.
  const lookup = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: trace.lastUsedPromptId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!trace.lastUsedPromptId,
      staleTime: 60_000,
      retry: false,
    },
  );
  const latestVersion = lookup.data?.version ?? null;
  const promptMissing = !!trace.lastUsedPromptId && lookup.isError;
  const outOfDate =
    !!trace.lastUsedPromptVersionNumber &&
    !!latestVersion &&
    latestVersion > trace.lastUsedPromptVersionNumber;

  const banner = hasDrift
    ? "yellow.500/6"
    : outOfDate
      ? "yellow.500/6"
      : promptMissing
        ? "bg.muted"
        : "bg.subtle";

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingX={4}
      paddingY={3}
      borderBottomWidth="1px"
      borderColor="border"
      bg={banner}
    >
      {hasDrift && (
        <HStack gap={2} align="flex-start">
          <Icon as={LuTriangleAlert} boxSize={3.5} color="yellow.fg" marginTop="2px" />
          <VStack align="stretch" gap={0.5}>
            <Text textStyle="xs" fontWeight="semibold" color="yellow.fg">
              Pinned prompt drifted at runtime
            </Text>
            <Text textStyle="2xs" color="fg.muted">
              The pin resolved to a different concrete prompt than what was
              recorded as last used. Common when a tag like{" "}
              <Text as="span" fontFamily="mono">
                production
              </Text>{" "}
              moves between deploys.
            </Text>
          </VStack>
        </HStack>
      )}

      {outOfDate && latestVersion != null && (
        <HStack gap={2} align="flex-start">
          <Icon as={LuTriangleAlert} boxSize={3.5} color="yellow.fg" marginTop="2px" />
          <VStack align="stretch" gap={0.5}>
            <Text textStyle="xs" fontWeight="semibold" color="yellow.fg">
              Trace ran an out-of-date prompt
            </Text>
            <Text textStyle="2xs" color="fg.muted">
              This trace used v{trace.lastUsedPromptVersionNumber}; the
              prompt&rsquo;s current latest is v{latestVersion}. Consider
              re-testing against the latest version before relying on this
              behaviour.
            </Text>
          </VStack>
        </HStack>
      )}

      {promptMissing && (
        <HStack gap={2} align="flex-start">
          <Icon as={LuCircleDashed} boxSize={3.5} color="fg.muted" marginTop="2px" />
          <VStack align="stretch" gap={0.5}>
            <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
              Prompt no longer exists in this project
            </Text>
            <Text textStyle="2xs" color="fg.muted">
              The trace still shows what ran at the time, but the
              underlying managed prompt has been deleted.
            </Text>
          </VStack>
        </HStack>
      )}

      {sameRef && trace.lastUsedPromptId ? (
        <PromptIdentityRow
          label="Pinned & ran"
          icon={LuCircleCheck}
          accent="blue"
          handle={trace.lastUsedPromptId}
          versionNumber={trace.lastUsedPromptVersionNumber}
          spanId={trace.lastUsedPromptSpanId}
          onSelectSpan={onSelectSpan}
        />
      ) : (
        <>
          {trace.selectedPromptId && (
            <PromptIdentityRow
              label="Selected"
              icon={LuCircleCheck}
              accent="blue"
              handle={trace.selectedPromptId}
              versionNumber={null}
              spanId={trace.selectedPromptSpanId}
              onSelectSpan={onSelectSpan}
            />
          )}
          {trace.lastUsedPromptId && (
            <PromptIdentityRow
              label="Last used"
              icon={LuSparkles}
              accent="purple"
              handle={trace.lastUsedPromptId}
              versionNumber={trace.lastUsedPromptVersionNumber}
              spanId={trace.lastUsedPromptSpanId}
              onSelectSpan={onSelectSpan}
            />
          )}
        </>
      )}
    </VStack>
  );
}

function PromptIdentityRow({
  label,
  icon,
  accent,
  handle,
  versionNumber,
  spanId,
  onSelectSpan,
}: {
  label: string;
  icon: typeof LuCircleCheck;
  accent: "blue" | "purple";
  handle: string;
  versionNumber: number | null;
  spanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  const accentColor = accent === "purple" ? "purple.fg" : "blue.fg";
  return (
    <HStack
      as={spanId ? "button" : "div"}
      onClick={spanId ? () => onSelectSpan(spanId) : undefined}
      gap={2}
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      cursor={spanId ? "pointer" : "default"}
      _hover={spanId ? { bg: "bg.muted" } : undefined}
      align="center"
      width="full"
      textAlign="left"
    >
      <Icon as={icon} boxSize={3.5} color={accentColor} flexShrink={0} />
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.04em"
        width="80px"
        flexShrink={0}
      >
        {label}
      </Text>
      <Text textStyle="sm" fontFamily="mono" color="fg" truncate flex={1} minWidth={0}>
        {handle}
      </Text>
      {versionNumber != null && (
        <Badge size="sm" variant="subtle" colorPalette={accent}>
          v{versionNumber}
        </Badge>
      )}
      {spanId && (
        <Icon as={LuArrowRight} boxSize={3} color="fg.subtle" flexShrink={0} />
      )}
    </HStack>
  );
}

function PromptUsageCard({
  usage,
  spanNameById,
  isLoadingSpans,
  onSelectSpan,
  onOpenPromptEditor,
}: {
  usage: PromptUsage;
  spanNameById: Map<string, SpanTreeNode>;
  isLoadingSpans: boolean;
  onSelectSpan: (spanId: string) => void;
  onOpenPromptEditor: (handle: string) => void;
}) {
  const { ref, spanIds, variables } = usage;
  const variableEntries = Object.entries(variables).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <VStack align="stretch" gap={3} paddingX={4} paddingY={4}>
      <HStack justify="space-between" gap={2}>
        <HStack gap={2} minWidth={0}>
          <Text
            textStyle="sm"
            fontWeight="bold"
            fontFamily="mono"
            truncate
            minWidth={0}
          >
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
        </HStack>
        <Button
          size="xs"
          variant="ghost"
          gap={1}
          onClick={() => onOpenPromptEditor(ref.handle)}
        >
          <Icon as={LuExternalLink} boxSize={3} />
          Open prompt
        </Button>
      </HStack>

      {/* Variables */}
      {variableEntries.length > 0 && (
        <VStack align="stretch" gap={1}>
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="0.04em"
          >
            Variables
          </Text>
          <Box
            bg="bg.subtle"
            borderRadius="md"
            borderWidth="1px"
            borderColor="border.muted"
            overflow="hidden"
          >
            {variableEntries.map(([key, val], i) => (
              <HStack
                key={key}
                paddingX={3}
                paddingY={1.5}
                borderBottomWidth={
                  i < variableEntries.length - 1 ? "1px" : "0px"
                }
                borderColor="border.muted"
                gap={3}
              >
                <Text
                  width="120px"
                  flexShrink={0}
                  textStyle="xs"
                  fontFamily="mono"
                  color="fg.muted"
                >
                  {key}
                </Text>
                <Text
                  flex={1}
                  textStyle="xs"
                  fontFamily="mono"
                  color="fg"
                  truncate
                  minWidth={0}
                >
                  {val}
                </Text>
              </HStack>
            ))}
          </Box>
        </VStack>
      )}

      {/* Spans that used this prompt */}
      <VStack align="stretch" gap={1}>
        <HStack justify="space-between">
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="0.04em"
          >
            Spans
          </Text>
          {spanIds.length > 0 && (
            <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
              {spanIds.length}
            </Text>
          )}
        </HStack>
        {isLoadingSpans ? (
          <VStack align="stretch" gap={1}>
            <Skeleton height="22px" />
            <Skeleton height="22px" width="80%" />
          </VStack>
        ) : spanIds.length === 0 ? (
          <Text textStyle="xs" color="fg.subtle">
            No span on this trace carries data for this prompt. The trace
            attributes record it, but the spans themselves don&rsquo;t expose
            the prompt id — likely emitted from a path that bypasses the
            span attribute.
          </Text>
        ) : (
          <VStack align="stretch" gap={0.5}>
            {spanIds.map((spanId) => {
              const span = spanNameById.get(spanId);
              return (
                <SpanRow
                  key={spanId}
                  spanId={spanId}
                  span={span ?? null}
                  onClick={() => onSelectSpan(spanId)}
                />
              );
            })}
          </VStack>
        )}
      </VStack>

      {/* Compact label fallback for a11y when no variables */}
      {variableEntries.length === 0 && spanIds.length > 0 && (
        <Tooltip
          content={`Prompt ${formatPromptReferenceLabel(ref)} ran on ${spanIds.length} span(s) without captured variables.`}
          positioning={{ placement: "top" }}
        >
          <Text textStyle="xs" color="fg.muted">
            No variables captured for these calls.
          </Text>
        </Tooltip>
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
      paddingX={2}
      paddingY={1}
      borderRadius="sm"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      align="center"
      width="full"
      textAlign="left"
    >
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        truncate
        flex={1}
        minWidth={0}
      >
        {span?.name ?? spanId}
      </Text>
      {span?.model && (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {abbreviateModel(span.model)}
        </Text>
      )}
      {span && (
        <Text textStyle="2xs" color="fg.subtle">
          {formatDuration(span.durationMs)}
        </Text>
      )}
    </HStack>
  );
}
