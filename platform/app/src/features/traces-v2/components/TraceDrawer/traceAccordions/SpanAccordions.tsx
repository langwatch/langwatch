import {
  Box,
  HStack,
  Icon,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useRef } from "react";
import { LuCircleX } from "react-icons/lu";
import {
  ContentPrivacyMarkers,
  PiiIncompleteNotice,
} from "~/components/ui/ContentPrivacyMarkers";
import { RedactedField } from "~/components/ui/RedactedField";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useAnchoredAnnotations } from "../../../hooks/useAnchoredAnnotations";
import { useSpanDetail } from "../../../hooks/useSpanDetail";
import { useSpanLogs } from "../../../hooks/useSpanLogs";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { useDrawerStore } from "../../../stores/drawerStore";
import { type AttributeComments, AttributeTable } from "../AttributeTable";
import { commentCountsBySection } from "../anchoredComments/sectionComments";
import { CorrectedFieldFrame } from "../editMode/CorrectedField";
import { CorrectedSpanScalars } from "../editMode/CorrectedSpanScalars";
import { SpanEditableIO } from "../editMode/SpanEditableIO";
import { SpanNameTypeEditor } from "../editMode/SpanNameTypeEditor";
import { useSpanAttributeEditing } from "../editMode/useSpanAttributeEditing";
import { useSpanCorrection } from "../editMode/useSpanCorrection";
import { IOViewer } from "../IOViewer";
import { hasPromptMetadata, PromptAccordion } from "../PromptAccordion";
import { ScopeBlock } from "../ScopeChip";
import { AccordionShell, Section } from "./AccordionShell";
import { EmptyEventsState, EmptyHint } from "./EmptyStates";
import { EventCard } from "./EventCard";
import { logEventTone, summarizeLogEvent } from "./logSummary";
import { SectionFocusGlow } from "./SectionFocusGlow";
import { useAutoOpenSections } from "./sectionPresence";
import { UnmappedCostSuggestion } from "./UnmappedCostSuggestion";
import { useSectionFocusGlow } from "./useSectionFocusGlow";
import { countFlatLeaves } from "./utils";

/**
 * Frames a field the correction changed, and leaves every other field exactly
 * as it renders normally.
 */
function MaybeCorrected({
  label,
  corrected,
  original,
  children,
}: {
  label: string;
  corrected: boolean;
  original: string | null | undefined;
  children: React.ReactNode;
}) {
  if (!corrected) return <>{children}</>;
  return (
    <CorrectedFieldFrame label={label} original={original}>
      {children}
    </CorrectedFieldFrame>
  );
}

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
  const isEditing = useDrawerStore((s) => s.isEditing);
  // What a stored correction changed about this span, and the span exactly as
  // captured, so each corrected field can show what it replaced.
  const { changedFields, captured } = useSpanCorrection(span.spanId);
  const attributeEditing = useSpanAttributeEditing({
    spanId: span.spanId,
    capturedParams:
      (detail?.params as Record<string, unknown> | undefined) ?? {},
    enabled: isEditing,
  });
  const resources = useTraceResources(traceId);
  const spanResource = resources.bySpanId[span.spanId] ?? null;
  const spanScope = spanResource?.scope ?? null;
  const { logsBySpanId, isLoading: logsLoading } = useSpanLogs();
  const spanLogs = logsBySpanId.get(span.spanId) ?? [];
  // What has been said about the parts of this span: a count on each section
  // header, and the comments each attribute row carries.
  const annotations = useAnchoredAnnotations();
  const sectionComments = useMemo(
    () =>
      commentCountsBySection({
        comments: annotations.all,
        anchorId: span.spanId,
      }),
    [annotations.all, span.spanId],
  );
  const attributeComments = useMemo<AttributeComments>(
    () => ({
      traceId,
      anchorId: span.spanId,
      pathPrefix: "params",
      commentsFor: (anchorPath) =>
        annotations.commentsAt({
          anchorKind: "field",
          anchorId: span.spanId,
          anchorPath,
        }),
    }),
    [traceId, span.spanId, annotations],
  );

  // Null checks rather than truthiness: a correction can set a field to the
  // empty string, and that is content the section holds, not an absence.
  const hasIO = detail?.input != null || detail?.output != null;
  // Any content category that is dropped, restricted, or restricted-but-visible
  // gives the I/O section something to show even when the content itself is
  // empty (so a fully hidden or dropped span still explains itself).
  const contentPrivacy = detail?.contentPrivacy;
  const piiIncomplete = !!detail?.piiAnalysisIncomplete;
  const hasPrivacyMarkers =
    piiIncomplete ||
    (!!contentPrivacy &&
      Object.values(contentPrivacy).some(
        (category) =>
          category.state !== "visible" || category.visibleTo != null,
      ));
  const hasResourceAttrs =
    !!spanResource && Object.keys(spanResource.resourceAttributes).length > 0;
  const hasSpanAttrs =
    !!detail?.params && Object.keys(detail.params).length > 0;
  const hasAttributes = hasSpanAttrs || hasResourceAttrs;
  const hasScope = !!spanScope?.name;
  // Prompt section only when there's actual prompt metadata. The no-prompt
  // case is covered by the "Open in Playground" affordance on the IOViewer
  // header — no value in rendering an empty Prompt accordion next to it.
  const hasPrompt = !!detail && hasPromptMetadata(detail.params);
  const hasError = span.status === "error" || !!detail?.error;
  const hasEvents = !!detail?.events && detail.events.length > 0;
  const hasLogs = spanLogs.length > 0;

  const sections = useMemo(() => {
    const list: string[] = [];
    if (hasError && !hasIO) list.push("exceptions");
    list.push("io");
    if (hasError && hasIO) list.push("exceptions");
    // A tool the user DENIED, an API retry, a mid-session compaction — none
    // of those produce a span of their own, so this is the only place they
    // show up at all. Placed right after I/O: when a span has logs, that is
    // usually the most interesting thing about it.
    if (hasLogs) list.push("logs");
    if (hasPrompt) list.push("prompt");
    list.push("attributes");
    // Instrumentation scope used to be a chip pinned to the right of
    // the SpanTabBar. Operator feedback: it took up tab-row real estate
    // for a piece of metadata most users glance at once and ignore.
    // Folded back into the accordion stack here — collapsed by default
    // unless the span actually reports a scope, so it's quiet when
    // empty and reachable when needed.
    if (hasScope) list.push("scope");
    list.push("events");
    return list;
  }, [hasError, hasIO, hasLogs, hasPrompt, hasScope]);

  // Same rule as the trace summary view: only auto-expand Attributes when
  // the span itself has attributes (resource-only is rarely interesting
  // and clutters the default view) or when an unmapped-cost suggestion
  // needs surfacing there.
  const [openSections, setOpenSections] = useAutoOpenSections(span.spanId, {
    exceptions: hasError,
    io: hasIO || hasPrivacyMarkers,
    logs: hasLogs,
    prompt: hasPrompt,
    attributes: hasSpanAttrs || !!detail?.costSuggestion,
    scope: hasScope,
    events: hasEvents,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const { glow, handleGlowDone } = useSectionFocusGlow({
    traceId,
    sections,
    openSections,
    setOpenSections,
    containerRef,
  });

  return (
    <Box ref={containerRef}>
      {isEditing && detail && (
        <SpanNameTypeEditor
          spanId={span.spanId}
          capturedName={detail.name}
          capturedType={detail.type}
        />
      )}
      {!isEditing && detail && (
        <CorrectedSpanScalars
          changedFields={changedFields}
          corrected={detail}
          captured={captured}
        />
      )}
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
          <Text textStyle="xs" color="fg.muted" truncate>
            Loading span{" "}
            <Text as="span" color="fg">
              {span.name}
            </Text>
            …
          </Text>
        </HStack>
      )}
      {glow ? (
        <SectionFocusGlow
          key={glow.nonce}
          target={glow.target}
          nonce={glow.nonce}
          onDone={handleGlowDone}
        />
      ) : null}
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
                  commentCount={sectionComments.io}
                  empty={!detailQuery.isLoading && !hasIO && !hasPrivacyMarkers}
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {detailQuery.isLoading ? (
                    <EmptyHint>Loading…</EmptyHint>
                  ) : (
                    <VStack align="stretch" gap={2}>
                      {/* Generic per-category privacy markers. Input/output use
                        skipRestricted because their hidden state already shows
                        inline via RedactedField below; system/tools (no inline
                        slot) show every state here. */}
                      <ContentPrivacyMarkers
                        privacy={contentPrivacy}
                        categories={["input", "output"]}
                        skipRestricted
                      />
                      <ContentPrivacyMarkers
                        privacy={contentPrivacy}
                        categories={["system", "tools"]}
                        framed
                      />
                      <PiiIncompleteNotice incomplete={piiIncomplete} />
                      <RedactedField
                        field="input"
                        redacted={detail?.inputRedacted ?? false}
                        visibleTo={detail?.inputVisibleTo}
                      >
                        {isEditing && detail ? (
                          <SpanEditableIO
                            spanId={detail.spanId}
                            field="input"
                            label="Input"
                            capturedText={detail.input ?? null}
                            capturedParams={detail.params}
                          />
                        ) : detail?.input != null ? (
                          <MaybeCorrected
                            label="Input"
                            corrected={changedFields.includes("input")}
                            original={captured?.input}
                          >
                            <IOViewer
                              label="Input"
                              content={detail.input}
                              mode="input"
                              traceId={traceId}
                              spanId={detail.spanId}
                              spanType={detail.type}
                            />
                          </MaybeCorrected>
                        ) : null}
                      </RedactedField>
                      <RedactedField
                        field="output"
                        redacted={detail?.outputRedacted ?? false}
                        visibleTo={detail?.outputVisibleTo}
                      >
                        {isEditing && detail ? (
                          <SpanEditableIO
                            spanId={detail.spanId}
                            field="output"
                            label="Output"
                            capturedText={detail.output ?? null}
                          />
                        ) : detail?.output != null ? (
                          <MaybeCorrected
                            label="Output"
                            corrected={changedFields.includes("output")}
                            original={captured?.output}
                          >
                            <IOViewer
                              label="Output"
                              content={detail.output}
                              mode="output"
                              traceId={traceId}
                              spanId={detail.spanId}
                              spanType={detail.type}
                            />
                          </MaybeCorrected>
                        ) : null}
                      </RedactedField>
                    </VStack>
                  )}
                </Section>
              );
            }
            if (id === "logs") {
              return (
                <Section
                  key="logs"
                  value="logs"
                  title="Logs"
                  count={spanLogs.length}
                  commentCount={sectionComments.logs}
                  empty={!logsLoading && spanLogs.length === 0}
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {logsLoading ? (
                    <EmptyHint>Loading…</EmptyHint>
                  ) : (
                    <VStack align="stretch" gap={2}>
                      {spanLogs.map((log, i) => {
                        const summary = summarizeLogEvent(log);
                        const attributes: Record<string, unknown> = {
                          ...log.attributes,
                        };
                        // The raw event name is redundant once it's been
                        // turned into a human summary — dropping it keeps the
                        // nested attribute table from repeating the headline.
                        const eventName = log.attributes["event.name"];
                        if (summary !== null) delete attributes["event.name"];
                        if (log.bodyRedacted) {
                          attributes.body = log.bodyVisibleTo
                            ? `[redacted — visible to ${log.bodyVisibleTo}]`
                            : "[redacted]";
                        } else if (log.body && log.body !== eventName) {
                          // Same discrimination the redaction layer applies:
                          // claude stamps the event-name MARKER into the
                          // top-level body, and copying that would both add a
                          // redundant row and overwrite the real content the
                          // raw api_*_body records carry under the `body`
                          // attribute.
                          attributes.body = log.body;
                        }
                        return (
                          <EventCard
                            key={`${log.timeUnixMs}-${i}`}
                            name={
                              summary ?? log.attributes["event.name"] ?? "log"
                            }
                            timestampMs={log.timeUnixMs}
                            anchorMs={span.startTimeMs}
                            attributes={attributes}
                            tone={logEventTone(log)}
                          />
                        );
                      })}
                    </VStack>
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
                  commentCount={sectionComments.attributes}
                  empty={
                    !hasAttributes &&
                    !isEditing &&
                    !resources.isLoading &&
                    !detailQuery.isLoading
                  }
                  isFirst={isFirst}
                  open={isOpen}
                >
                  {!detailQuery.isLoading && detail?.costSuggestion && (
                    <UnmappedCostSuggestion
                      model={detail.costSuggestion.model}
                    />
                  )}
                  {hasAttributes || isEditing ? (
                    <AttributeTable
                      attributes={attributeEditing.baselineParams}
                      resourceAttributes={
                        hasResourceAttrs
                          ? spanResource!.resourceAttributes
                          : undefined
                      }
                      restrictedAttributes={detail?.restrictedAttributes}
                      title="Span Attributes"
                      spanId={detail?.spanId ?? span.spanId}
                      editing={attributeEditing.editing}
                      correctedFrom={
                        changedFields.includes("params")
                          ? ((captured?.params as
                              | Record<string, unknown>
                              | undefined) ?? {})
                          : undefined
                      }
                      comments={attributeComments}
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
                  <VStack align="stretch" gap={2}>
                    {detail!.events.map((evt, i) => (
                      <EventCard
                        key={`${evt.timestampMs}-${evt.name}-${i}`}
                        name={evt.name}
                        timestampMs={evt.timestampMs}
                        anchorMs={span.startTimeMs}
                        attributes={evt.attributes}
                      />
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
