import { Accordion, Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCalendarClock, LuCircleX } from "react-icons/lu";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TraceHeader, SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useSpanDetail } from "../../hooks/useSpanDetail";
import { useTraceEvaluations } from "../../hooks/useTraceEvaluations";
import { useTraceResources } from "../../hooks/useTraceResources";
import { IOViewer } from "./IOViewer";
import { AttributeTable } from "./AttributeTable";
import { EvalsList } from "./EvalCards";
import { hasPromptMetadata, PromptAccordion } from "./PromptAccordion";
import { ScopeBlock } from "./ScopeChip";

function countFlatLeaves(obj: Record<string, unknown> | undefined | null): number {
  if (!obj) return 0;
  let n = 0;
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      n += countFlatLeaves(v as Record<string, unknown>);
    } else {
      n += 1;
    }
  }
  return n;
}

interface TraceAccordionsProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  activeTab: "summary" | "span";
  onSelectSpan?: (spanId: string) => void;
}

export function TraceAccordions({
  trace,
  spans,
  selectedSpan,
  activeTab,
  onSelectSpan,
}: TraceAccordionsProps) {
  if (activeTab === "span" && selectedSpan) {
    return (
      <SpanAccordions
        traceId={trace.traceId}
        span={selectedSpan}
        onSelectSpan={onSelectSpan}
      />
    );
  }
  return (
    <TraceSummaryAccordions trace={trace} spans={spans} onSelectSpan={onSelectSpan} />
  );
}

function AccordionShell({
  children,
  value,
  onValueChange,
}: {
  children: ReactNode;
  value: string[];
  onValueChange: (next: string[]) => void;
}) {
  return (
    <Accordion.Root
      multiple
      value={value}
      onValueChange={(e) => onValueChange(e.value)}
    >
      {children}
    </Accordion.Root>
  );
}

/**
 * Tracks accordion open-state with auto-expand:
 * - On identity change (new trace / new span), reset to all sections that
 *   currently have content.
 * - On content arriving asynchronously within the same identity, open the
 *   newly-populated section (without re-opening sections the user closed).
 * - User toggles inside an identity are preserved.
 */
function useAutoOpenSections(
  identity: string,
  content: Record<string, boolean>,
): [string[], (next: string[]) => void] {
  const [open, setOpen] = useState<string[]>(() =>
    Object.entries(content)
      .filter(([, has]) => has)
      .map(([k]) => k),
  );
  const lastIdentityRef = useRef(identity);
  const prevContentRef = useRef(content);

  // Stable serialization for the effect dep.
  const contentKey = Object.entries(content)
    .map(([k, v]) => `${k}=${v ? 1 : 0}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (lastIdentityRef.current !== identity) {
      lastIdentityRef.current = identity;
      prevContentRef.current = content;
      setOpen(
        Object.entries(content)
          .filter(([, has]) => has)
          .map(([k]) => k),
      );
      return;
    }
    // Same identity — auto-open sections that just gained content.
    setOpen((prev) => {
      const set = new Set(prev);
      let changed = false;
      for (const [key, hasContent] of Object.entries(content)) {
        if (hasContent && !prevContentRef.current[key] && !set.has(key)) {
          set.add(key);
          changed = true;
        }
      }
      prevContentRef.current = content;
      return changed ? Array.from(set) : prev;
    });
    // identity + contentKey are sufficient — content object is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, contentKey]);

  return [open, setOpen];
}

function Section({
  value,
  title,
  count,
  children,
  isFirst,
}: {
  value: string;
  title: string;
  count?: number;
  children: ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <Accordion.Item value={value} border="0">
      <Accordion.ItemTrigger
        width="100%"
        paddingX={4}
        paddingY={2.5}
        borderTopWidth={isFirst ? "0" : "1px"}
        borderColor="border.muted"
        _hover={{ bg: "bg.muted" }}
        cursor="pointer"
      >
        <HStack flex={1} gap={2}>
          <Text textStyle="sm" fontWeight="semibold">
            {title}
          </Text>
          {count != null && count > 0 && (
            <Text
              textStyle="xs"
              fontFamily="mono"
              color="fg.subtle"
              fontWeight="normal"
            >
              · {count}
            </Text>
          )}
        </HStack>
        <Accordion.ItemIndicator />
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <Box paddingX={4} paddingY={2} paddingBottom={3}>
          {children}
        </Box>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}

function TraceSummaryAccordions({
  trace,
  spans,
  onSelectSpan,
}: {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const hasIO = !!(trace.input || trace.output);
  const traceAttributes = trace.attributes ?? {};
  const traceEvents = trace.events ?? [];
  const resources = useTraceResources(trace.traceId);
  const hasResourceAttributes =
    Object.keys(resources.resourceAttributes).length > 0;
  const hasAttributes =
    Object.keys(traceAttributes).length > 0 || hasResourceAttributes;
  const hasScope = !!resources.scope?.name;
  const hasError = trace.status === "error" && !!trace.error;

  const { rich: richEvals, pendingCount, isLoading: evalsLoading } =
    useTraceEvaluations();

  const evalsForList = useMemo(
    () =>
      richEvals.map((e) => ({
        ...e,
        spanName: e.spanId
          ? spans.find((s) => s.spanId === e.spanId)?.name
          : undefined,
      })),
    [richEvals, spans],
  );

  const sections = useMemo(() => {
    const list: Array<
      "io" | "attributes" | "scope" | "evals" | "events" | "exceptions"
    > = [];
    if (hasError && !hasIO) list.push("exceptions");
    list.push("io");
    if (hasError && hasIO) list.push("exceptions");
    list.push("attributes");
    if (hasScope) list.push("scope");
    list.push("evals");
    list.push("events");
    return list;
  }, [hasIO, hasError, hasScope]);

  const hasEvalsContent = evalsForList.length > 0 || pendingCount > 0;
  const hasEventsContent = traceEvents.length > 0;

  const [openSections, setOpenSections] = useAutoOpenSections(trace.traceId, {
    exceptions: hasError,
    io: hasIO,
    attributes: hasAttributes,
    scope: hasScope,
    evals: hasEvalsContent,
    events: hasEventsContent,
  });

  return (
    <AccordionShell value={openSections} onValueChange={setOpenSections}>
      {sections.map((id, idx) => {
        const isFirst = idx === 0;
        if (id === "io") {
          return (
            <Section key="io" value="io" title="I/O" isFirst={isFirst}>
              {hasIO ? (
                <VStack align="stretch" gap={2}>
                  {trace.input && <IOViewer label="Input" content={trace.input} />}
                  {trace.output && <IOViewer label="Output" content={trace.output} />}
                </VStack>
              ) : (
                <EmptyHint>No I/O captured for this trace</EmptyHint>
              )}
            </Section>
          );
        }
        if (id === "attributes") {
          const attrCount =
            countFlatLeaves(traceAttributes) +
            countFlatLeaves(resources.resourceAttributes);
          return (
            <Section
              key="attributes"
              value="attributes"
              title="Metadata"
              count={attrCount}
              isFirst={isFirst}
            >
              {hasAttributes ? (
                <AttributeTable
                  attributes={traceAttributes}
                  resourceAttributes={
                    hasResourceAttributes
                      ? resources.resourceAttributes
                      : undefined
                  }
                  title="Trace Attributes"
                />
              ) : resources.isLoading ? (
                <EmptyHint>Loading metadata…</EmptyHint>
              ) : (
                <EmptyHint>No metadata recorded</EmptyHint>
              )}
            </Section>
          );
        }
        if (id === "scope") {
          return (
            <Section
              key="scope"
              value="scope"
              title="Instrumentation Scope"
              isFirst={isFirst}
            >
              <ScopeBlock scope={resources.scope} />
            </Section>
          );
        }
        if (id === "exceptions") {
          return (
            <Section key="exceptions" value="exceptions" title="Exceptions" isFirst={isFirst}>
              <HStack
                gap={2}
                paddingX={3}
                paddingY={2}
                borderRadius="sm"
                bg="red.subtle"
                align="flex-start"
              >
                <Icon
                  as={LuCircleX}
                  boxSize={4}
                  color="red.fg"
                  flexShrink={0}
                  marginTop={0.5}
                />
                <Text
                  textStyle="xs"
                  color="red.fg"
                  fontFamily="mono"
                  whiteSpace="pre-wrap"
                >
                  {trace.error}
                </Text>
              </HStack>
            </Section>
          );
        }
        if (id === "evals") {
          return (
            <Section
              key="evals"
              value="evals"
              title="Evals"
              count={evalsForList.length > 0 ? evalsForList.length : undefined}
              isFirst={isFirst}
            >
              {evalsLoading ? (
                <EmptyHint>Loading evaluations…</EmptyHint>
              ) : (
                <VStack align="stretch" gap={2}>
                  {pendingCount > 0 && (
                    <Text textStyle="xs" color="fg.muted">
                      {pendingCount} evaluation{pendingCount === 1 ? "" : "s"}{" "}
                      pending
                    </Text>
                  )}
                  <EvalsList
                    evals={evalsForList}
                    onSelectSpan={onSelectSpan}
                  />
                </VStack>
              )}
            </Section>
          );
        }
        // events
        return (
          <Section
            key="events"
            value="events"
            title="Events"
            count={traceEvents.length > 0 ? traceEvents.length : undefined}
            isFirst={isFirst}
          >
            {traceEvents.length > 0 ? (
              <VStack align="stretch" gap={1}>
                {traceEvents.map((evt, i) => (
                  <HStack key={`${evt.spanId}-${evt.timestamp}-${i}`} gap={3}>
                    <Text textStyle="xs" fontWeight="medium">
                      {evt.name}
                    </Text>
                    <Text
                      textStyle="xs"
                      color="fg.subtle"
                      fontFamily="mono"
                    >
                      +{Math.max(0, Math.round(evt.timestamp - trace.timestamp))}ms
                    </Text>
                    {onSelectSpan && (
                      <Button
                        size="xs"
                        variant="ghost"
                        marginLeft="auto"
                        onClick={() => onSelectSpan(evt.spanId)}
                      >
                        View span
                      </Button>
                    )}
                  </HStack>
                ))}
              </VStack>
            ) : (
              <EmptyEventsState />
            )}
          </Section>
        );
      })}
    </AccordionShell>
  );
}

function SpanAccordions({
  traceId,
  span,
  onSelectSpan,
}: {
  traceId: string;
  span: SpanTreeNode;
  onSelectSpan?: (spanId: string) => void;
}) {
  const detailQuery = useSpanDetail();
  const detail = detailQuery.data;
  const resources = useTraceResources(traceId);
  const spanResource = resources.bySpanId[span.spanId] ?? null;
  const spanScope = spanResource?.scope ?? null;

  const hasIO = !!(detail?.input || detail?.output);
  const hasResourceAttrs =
    !!spanResource && Object.keys(spanResource.resourceAttributes).length > 0;
  const hasAttributes =
    (!!detail?.params && Object.keys(detail.params).length > 0) ||
    hasResourceAttrs;
  const hasScope = !!(spanScope && spanScope.name);
  const hasPrompt =
    !!detail && hasPromptMetadata(detail.params);
  const hasError = span.status === "error" || !!detail?.error;
  const hasEvents = !!detail?.events && detail.events.length > 0;

  const sections = useMemo(() => {
    const list: string[] = [];
    if (hasError && !hasIO) list.push("exceptions");
    list.push("io");
    if (hasError && hasIO) list.push("exceptions");
    if (hasPrompt) list.push("prompt");
    list.push("attributes");
    if (hasScope) list.push("scope");
    list.push("events");
    return list;
  }, [hasError, hasIO, hasPrompt, hasScope]);

  const [openSections, setOpenSections] = useAutoOpenSections(span.spanId, {
    exceptions: hasError,
    io: hasIO,
    prompt: hasPrompt,
    attributes: hasAttributes,
    scope: hasScope,
    events: hasEvents,
  });

  return (
    <AccordionShell value={openSections} onValueChange={setOpenSections}>
      {sections.map((id, idx) => {
        const isFirst = idx === 0;
        if (id === "io") {
          return (
            <Section key="io" value="io" title="I/O" isFirst={isFirst}>
              {detailQuery.isLoading ? (
                <EmptyHint>Loading…</EmptyHint>
              ) : hasIO ? (
                <VStack align="stretch" gap={2}>
                  {detail?.input && <IOViewer label="Input" content={detail.input} />}
                  {detail?.output && <IOViewer label="Output" content={detail.output} />}
                </VStack>
              ) : (
                <EmptyHint>No I/O captured for this span</EmptyHint>
              )}
            </Section>
          );
        }
        if (id === "prompt") {
          return (
            <Section key="prompt" value="prompt" title="Prompt" isFirst={isFirst}>
              {detail && <PromptAccordion span={detail} />}
            </Section>
          );
        }
        if (id === "attributes") {
          const attrCount =
            countFlatLeaves(detail?.params as Record<string, unknown> | undefined) +
            countFlatLeaves(spanResource?.resourceAttributes);
          return (
            <Section
              key="attributes"
              value="attributes"
              title="Attributes"
              count={attrCount}
              isFirst={isFirst}
            >
              {hasAttributes ? (
                <AttributeTable
                  attributes={
                    (detail?.params as Record<string, unknown> | undefined) ?? {}
                  }
                  resourceAttributes={
                    hasResourceAttrs
                      ? spanResource!.resourceAttributes
                      : undefined
                  }
                  title="Span Attributes"
                />
              ) : resources.isLoading || detailQuery.isLoading ? (
                <EmptyHint>Loading attributes…</EmptyHint>
              ) : (
                <EmptyHint>No additional attributes recorded</EmptyHint>
              )}
            </Section>
          );
        }
        if (id === "scope") {
          return (
            <Section
              key="scope"
              value="scope"
              title="Instrumentation Scope"
              isFirst={isFirst}
            >
              <ScopeBlock scope={spanScope} />
            </Section>
          );
        }
        if (id === "exceptions") {
          return (
            <Section key="exceptions" value="exceptions" title="Exceptions" isFirst={isFirst}>
              {detail?.error ? (
                <VStack align="stretch" gap={2}>
                  <HStack
                    gap={2}
                    paddingX={3}
                    paddingY={2}
                    borderRadius="sm"
                    bg="red.subtle"
                    align="flex-start"
                  >
                    <Icon
                      as={LuCircleX}
                      boxSize={4}
                      color="red.fg"
                      flexShrink={0}
                      marginTop={0.5}
                    />
                    <Text
                      textStyle="xs"
                      color="red.fg"
                      fontFamily="mono"
                      whiteSpace="pre-wrap"
                      fontWeight="semibold"
                    >
                      {detail.error.message}
                    </Text>
                  </HStack>
                  {detail.error.stacktrace.length > 0 && (
                    <Box
                      bg="bg.subtle"
                      borderRadius="sm"
                      borderWidth="1px"
                      borderColor="border"
                      padding={2}
                      fontFamily="mono"
                      textStyle="xs"
                      color="fg.muted"
                      whiteSpace="pre-wrap"
                      maxHeight="280px"
                      overflow="auto"
                    >
                      {detail.error.stacktrace.join("\n")}
                    </Box>
                  )}
                </VStack>
              ) : (
                <EmptyHint>Error status with no exception details</EmptyHint>
              )}
            </Section>
          );
        }
        // events
        return (
          <Section
            key="events"
            value="events"
            title="Events"
            count={hasEvents ? detail!.events.length : undefined}
            isFirst={isFirst}
          >
            {hasEvents ? (
              <VStack align="stretch" gap={1}>
                {detail!.events.map((evt) => (
                  <HStack key={`${evt.timestampMs}-${evt.name}`} gap={3}>
                    <Text textStyle="xs" fontWeight="medium">
                      {evt.name}
                    </Text>
                    <Text textStyle="xs" color="fg.subtle" fontFamily="mono">
                      +{Math.round(evt.timestampMs - span.startTimeMs)}ms
                    </Text>
                  </HStack>
                ))}
              </VStack>
            ) : (
              <EmptyEventsState />
            )}
          </Section>
        );
      })}
    </AccordionShell>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="xs" color="fg.subtle">
      {children}
    </Text>
  );
}

function EmptyEventsState() {
  return (
    <VStack gap={2} alignItems="center" textAlign="center" maxWidth="220px" marginX="auto" paddingY={3}>
      <Icon as={LuCalendarClock} boxSize={5} color="fg.subtle" />
      <VStack gap={1}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          No events recorded
        </Text>
        <Text textStyle="xs" color="fg.subtle">
          Events capture key moments like tool calls, user feedback, or custom milestones.
        </Text>
      </VStack>
      <Button size="xs" variant="outline" asChild>
        <a href="https://docs.langwatch.ai/integration/overview" target="_blank" rel="noopener noreferrer">
          Learn more
        </a>
      </Button>
    </VStack>
  );
}
