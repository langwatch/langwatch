import {
  Box,
  HStack,
  Icon,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { LuCircleX } from "react-icons/lu";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useSpanDetail } from "../../../hooks/useSpanDetail";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { AttributeTable } from "../AttributeTable";
import { IOViewer } from "../IOViewer";
import { hasPromptMetadata, PromptAccordion } from "../PromptAccordion";
import { ScopeBlock, ScopeChip } from "../ScopeChip";
import { AccordionShell, Section } from "./AccordionShell";
import { EmptyEventsState, EmptyHint } from "./EmptyStates";
import { useAutoOpenSections } from "./sectionPresence";
import { countFlatLeaves } from "./utils";

export function SpanAccordions({
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
  const hasSpanAttrs =
    !!detail?.params && Object.keys(detail.params).length > 0;
  const hasAttributes = hasSpanAttrs || hasResourceAttrs;
  const hasScope = !!spanScope?.name;
  const hasPrompt = !!detail && hasPromptMetadata(detail.params);
  const hasError = span.status === "error" || !!detail?.error;
  const hasEvents = !!detail?.events && detail.events.length > 0;

  const sections = useMemo(() => {
    const list: string[] = [];
    if (hasError && !hasIO) list.push("exceptions");
    list.push("io");
    if (hasError && hasIO) list.push("exceptions");
    if (hasPrompt) list.push("prompt");
    list.push("attributes");
    // Scope chip lives in the span header — no dedicated section needed.
    list.push("events");
    return list;
  }, [hasError, hasIO, hasPrompt]);

  // Same rule as the trace summary view: only auto-expand Attributes when
  // the span itself has attributes — resource-only is rarely interesting
  // and clutters the default view.
  const [openSections, setOpenSections] = useAutoOpenSections(span.spanId, {
    exceptions: hasError,
    io: hasIO,
    prompt: hasPrompt,
    attributes: hasSpanAttrs,
    scope: hasScope,
    events: hasEvents,
  });

  return (
    <Box>
      {/* Span-switch loading banner — makes it explicit that the panel
        below is still resolving, instead of letting the user stare at
        an empty accordion stack and wonder if anything's happening. */}
      {detailQuery.isLoading && (
        <HStack
          paddingX={4}
          paddingY={2}
          gap={2}
          bg="bg.subtle"
          borderBottomWidth="1px"
          borderColor="border.muted"
        >
          <Spinner size="xs" color="blue.fg" />
          <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate>
            Loading span{" "}
            <Text as="span" color="fg">
              {span.name}
            </Text>
            …
          </Text>
        </HStack>
      )}
      {hasScope && (
        <Box
          paddingX={4}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.muted"
        >
          <ScopeChip scope={spanScope} />
        </Box>
      )}
      {detailQuery.isLoading ? (
        <VStack align="stretch" gap={2} padding={4}>
          <Skeleton height="32px" borderRadius="md" />
          <Skeleton height="100px" borderRadius="md" />
          <Skeleton height="64px" borderRadius="md" />
        </VStack>
      ) : (
        <AccordionShell value={openSections} onValueChange={setOpenSections}>
          {sections.map((id, idx) => {
            const isFirst = idx === 0;
            const isOpen = openSections.includes(id);
            if (id === "io") {
              return (
                <Section
                  key="io"
                  value="io"
                  title="Input and Output"
                  empty={!detailQuery.isLoading && !hasIO}
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {detailQuery.isLoading ? (
                    <EmptyHint>Loading…</EmptyHint>
                  ) : hasIO ? (
                    <VStack align="stretch" gap={2}>
                      {detail?.input && (
                        <IOViewer
                          label="Input"
                          content={detail.input}
                          mode="input"
                        />
                      )}
                      {detail?.output && (
                        <IOViewer
                          label="Output"
                          content={detail.output}
                          mode="output"
                        />
                      )}
                    </VStack>
                  ) : (
                    <EmptyHint>No I/O captured for this span</EmptyHint>
                  )}
                </Section>
              );
            }
            if (id === "prompt") {
              return (
                <Section
                  key="prompt"
                  value="prompt"
                  title="Prompt"
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {detail && <PromptAccordion span={detail} />}
                </Section>
              );
            }
            if (id === "attributes") {
              const attrCount =
                countFlatLeaves(
                  detail?.params as Record<string, unknown> | undefined,
                ) + countFlatLeaves(spanResource?.resourceAttributes);
              return (
                <Section
                  key="attributes"
                  value="attributes"
                  title="Attributes"
                  count={attrCount}
                  empty={
                    !hasAttributes &&
                    !resources.isLoading &&
                    !detailQuery.isLoading
                  }
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {hasAttributes ? (
                    <AttributeTable
                      attributes={
                        (detail?.params as
                          | Record<string, unknown>
                          | undefined) ?? {}
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
                  open={isOpen}
                >
                  <ScopeBlock scope={spanScope} />
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
                  open={isOpen}
                >
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
                    <EmptyHint>
                      Error status with no exception details
                    </EmptyHint>
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
                empty={!detailQuery.isLoading && !hasEvents}
                isFirst={isFirst}
                open={isOpen}
              >
                {hasEvents ? (
                  <VStack align="stretch" gap={1}>
                    {detail!.events.map((evt) => (
                      <HStack key={`${evt.timestampMs}-${evt.name}`} gap={3}>
                        <Text textStyle="xs" fontWeight="medium">
                          {evt.name}
                        </Text>
                        <Text
                          textStyle="xs"
                          color="fg.subtle"
                          fontFamily="mono"
                        >
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
      )}
    </Box>
  );
}
