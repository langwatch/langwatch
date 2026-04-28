import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { LuCircleX } from "react-icons/lu";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useTraceEvaluations } from "../../../hooks/useTraceEvaluations";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { AttributeTable } from "../AttributeTable";
import { EvalsList } from "../evalCards";
import { IOViewer } from "../IOViewer";
import { ScopeBlock, ScopeChip } from "../ScopeChip";
import { AccordionShell, Section } from "./AccordionShell";
import { EmptyEventsState, EmptyHint } from "./EmptyStates";
import { useAutoOpenSections } from "./sectionPresence";
import { countFlatLeaves } from "./utils";

export function TraceSummaryAccordions({
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
  const hasTraceAttributes = Object.keys(traceAttributes).length > 0;
  const hasAttributes = hasTraceAttributes || hasResourceAttributes;
  const hasScope = !!resources.scope?.name;
  const hasError = trace.status === "error" && !!trace.error;

  const {
    rich: richEvals,
    pendingCount,
    isLoading: evalsLoading,
  } = useTraceEvaluations();

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
    // Instrumentation scope is surfaced as a chip in the trace header (via
    // sdkInfo) — no need for a separate accordion section here. Keeping the
    // hook in case we want to bring it back later.
    list.push("evals");
    list.push("events");
    return list;
  }, [hasIO, hasError]);

  const hasEvalsContent = evalsForList.length > 0 || pendingCount > 0;
  const hasEventsContent = traceEvents.length > 0;

  // Auto-open Metadata only when the trace has its own attributes — when
  // only resource attributes are present (which is most of the time on
  // SDK-instrumented traces), keep the section collapsed so users aren't
  // distracted by long resource dumps that rarely change between traces.
  const [openSections, setOpenSections] = useAutoOpenSections(trace.traceId, {
    exceptions: hasError,
    io: hasIO,
    attributes: hasTraceAttributes,
    scope: hasScope,
    evals: hasEvalsContent,
    events: hasEventsContent,
  });

  return (
    <Box>
      {hasScope && (
        <Box
          paddingX={4}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.muted"
        >
          <ScopeChip scope={resources.scope} />
        </Box>
      )}
      <AccordionShell value={openSections} onValueChange={setOpenSections}>
        {sections.map((id, idx) => {
          const isFirst = idx === 0;
          if (id === "io") {
            return (
              <Section
                key="io"
                value="io"
                title="Input and Output"
                empty={!hasIO}
                isFirst={isFirst}
              >
                {hasIO ? (
                  <VStack align="stretch" gap={2}>
                    {trace.input && (
                      <IOViewer
                        label="Input"
                        content={trace.input}
                        traceId={trace.traceId}
                      />
                    )}
                    {trace.output && (
                      <IOViewer
                        label="Output"
                        content={trace.output}
                        mode="output"
                        traceId={trace.traceId}
                      />
                    )}
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
                empty={!hasAttributes && !resources.isLoading}
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
              <Section
                key="exceptions"
                value="exceptions"
                title="Exceptions"
                isFirst={isFirst}
              >
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
                count={
                  evalsForList.length > 0 ? evalsForList.length : undefined
                }
                empty={
                  !evalsLoading &&
                  evalsForList.length === 0 &&
                  pendingCount === 0
                }
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
              empty={traceEvents.length === 0}
              isFirst={isFirst}
            >
              {traceEvents.length > 0 ? (
                <VStack align="stretch" gap={1}>
                  {traceEvents.map((evt, i) => (
                    <HStack key={`${evt.spanId}-${evt.timestamp}-${i}`} gap={3}>
                      <Text textStyle="xs" fontWeight="medium">
                        {evt.name}
                      </Text>
                      <Text textStyle="xs" color="fg.subtle" fontFamily="mono">
                        +
                        {Math.max(
                          0,
                          Math.round(evt.timestamp - trace.timestamp),
                        )}
                        ms
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
    </Box>
  );
}
