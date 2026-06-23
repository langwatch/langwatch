import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useRef } from "react";
import { LuCalendarClock, LuFileText, LuFlaskConical } from "react-icons/lu";
import { PrivacyDroppedNotice } from "~/components/ui/PrivacyDroppedNotice";
import { RedactedField } from "~/components/ui/RedactedField";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useTraceEvaluations } from "../../../hooks/useTraceEvaluations";
import { useTraceEvents } from "../../../hooks/useTraceEvents";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { useFocusSectionStore } from "../../../stores/focusSectionStore";
import { rankedErrorSpans } from "../../../utils/errorSpans";
import { AttributeTable } from "../AttributeTable";
import { ExceptionsContent } from "../ExceptionsContent";
import { EvalsList } from "../evalCards";
import { IOViewer } from "../IOViewer";
import { PromptsPanel } from "../PromptsPanel";
import { ScopeBlock } from "../ScopeChip";
import { AccordionShell, Section } from "./AccordionShell";
import { EmptyHint, EmptySignalCard } from "./EmptyStates";
import { EventCard } from "./EventCard";
import { SectionFocusGlow } from "./SectionFocusGlow";
import { useAutoOpenSections } from "./sectionPresence";
import { useSectionFocusGlow } from "./useSectionFocusGlow";
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
  // A restrict privacy rule hides content the viewer may not see — the server
  // nulls `input`/`output` and sets these flags. The IO section then reads as a
  // "Redacted" state, NOT an "empty" one: there IS content, it is just hidden.
  const hasRedactedIO = !!(trace.inputRedacted || trace.outputRedacted);
  const traceAttributes = trace.attributes ?? {};
  // Trace-level events are read as their own query (like evaluations), not off
  // the header: the fold no longer carries them, so they're derived from
  // stored_spans on demand. Includes legacy `/track-event` payloads, which the
  // SDK attaches to a synthetic span as OTel span events.
  const { events: traceEvents, isLoading: eventsLoading } = useTraceEvents();
  const { project } = useOrganizationTeamProject();
  const promptsHref = project?.slug ? `/${project.slug}/prompts` : undefined;
  const resources = useTraceResources(trace.traceId);
  const hasResourceAttributes =
    Object.keys(resources.resourceAttributes).length > 0;
  const hasTraceAttributes = Object.keys(traceAttributes).length > 0;
  const hasAttributes = hasTraceAttributes || hasResourceAttributes;
  const hasScope = !!resources.scope?.name;

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

  // Spans flagged with status=error, deepest-first so the most
  // specific failure (the leaf that actually threw) leads the pill row.
  // Same ranking is reused by the StatusChip's interactive tooltip so
  // the operator sees the same span order whether they're scanning
  // the popover or the expanded accordion.
  const errorSpans = useMemo(
    () => (trace.status === "error" ? rankedErrorSpans(spans) : []),
    [spans, trace.status],
  );
  // Surface the Exceptions section whenever an error trace has either
  // a trace-level error string or at least one errored span. The latter
  // matters for traces that only have span-level failures (no rolled
  // up trace.error), where the header chip would otherwise list pills
  // that lead to a section gate that never opens.
  const hasError =
    trace.status === "error" && (!!trace.error || errorSpans.length > 0);

  const hasEvalsContent = evalsForList.length > 0 || pendingCount > 0;
  const hasEventsContent = traceEvents.length > 0;

  // A signal counts as "empty" (→ compact card) only once its query has
  // settled with nothing. While it's still loading it's neither a full
  // section (no content yet) nor a card (not confirmed empty) — simply
  // absent, so it never flashes a full-width empty state before settling.
  const evalsEmpty = !hasEvalsContent && !evalsLoading;
  const eventsEmpty = !hasEventsContent && !eventsLoading;
  const promptsEmpty = !trace.containsPrompt;

  // Empty signals collapse into one shared "Other" section as compact cards
  // rather than each eating a full-width accordion. Ordered evals → events →
  // prompts to mirror their normal section order.
  const emptyCards = useMemo(
    () =>
      [
        evalsEmpty ? ("evals" as const) : null,
        eventsEmpty ? ("events" as const) : null,
        promptsEmpty ? ("prompts" as const) : null,
      ].filter((v): v is "evals" | "events" | "prompts" => v !== null),
    [evalsEmpty, eventsEmpty, promptsEmpty],
  );
  const showOther = emptyCards.length > 0;

  const sections = useMemo(() => {
    const list: Array<
      | "io"
      | "prompts"
      | "attributes"
      | "scope"
      | "evals"
      | "events"
      | "exceptions"
      | "other"
    > = [];
    if (hasError && !hasIO) list.push("exceptions");
    list.push("io");
    if (hasError && hasIO) list.push("exceptions");
    // Prompts the trace used — the span-level Prompt accordion only shows
    // when a span is selected, so the trace summary surfaced no prompt
    // info even when spans carried managed prompts. `containsPrompt` is
    // the cheap trace-level precondition. When absent, the prompt CTA moves
    // into the shared "Other" section below.
    if (trace.containsPrompt) list.push("prompts");
    list.push("attributes");
    // Evals / Events render as their own full-width section only once their
    // query has content. Confirmed-empty ones drop into "Other" as a compact
    // card; while a query is still loading the signal is simply absent (no
    // placeholder), so it never flashes a full-width empty state on the way
    // to becoming a card.
    if (hasEvalsContent) list.push("evals");
    if (hasEventsContent) list.push("events");
    if (showOther) list.push("other");
    return list;
  }, [
    hasIO,
    hasError,
    trace.containsPrompt,
    hasEvalsContent,
    hasEventsContent,
    showOther,
  ]);

  // Auto-open Metadata only when the trace has its own attributes — when
  // only resource attributes are present (which is most of the time on
  // SDK-instrumented traces), keep the section collapsed so users aren't
  // distracted by long resource dumps that rarely change between traces.
  const [openSections, setOpenSections] = useAutoOpenSections(trace.traceId, {
    exceptions: hasError,
    io: hasIO || hasRedactedIO,
    prompts: trace.containsPrompt,
    attributes: hasTraceAttributes,
    scope: hasScope,
    evals: hasEvalsContent,
    events: hasEventsContent,
    other: showOther,
  });

  // Observe focus-section signals from external surfaces (header chips,
  // overflow menus, …). When a request matches this trace, ensure the
  // requested section is in `openSections` and scroll it into view.
  const containerRef = useRef<HTMLDivElement>(null);
  const requestFocus = useFocusSectionStore((s) => s.request);
  const { glow, handleGlowDone } = useSectionFocusGlow({
    traceId: trace.traceId,
    sections,
    openSections,
    setOpenSections,
    containerRef,
  });

  return (
    <Box ref={containerRef}>
      {/* The instrumentation scope used to render here as a small
          attribution row at the top of the summary panel. It's now
          pinned to the right of the SpanTabBar so it stays visible
          when the user scrolls the summary content. */}
      {glow ? (
        <SectionFocusGlow
          key={glow.nonce}
          target={glow.target}
          nonce={glow.nonce}
          onDone={handleGlowDone}
        />
      ) : null}
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
                // Redacted content is hidden, not absent — don't tag the section
                // "empty" when a privacy rule nulled the I/O.
                empty={!hasIO && !hasRedactedIO}
                spotlightAnchor={hasIO ? "drawer-io" : undefined}
                isFirst={isFirst}
                open={isOpen}
              >
                <VStack align="stretch" gap={2}>
                  <PrivacyDroppedNotice
                    categories={trace.privacy?.droppedCategories ?? undefined}
                  />
                  {/* Drive redaction off the header DTO's own flags (like the
                      span path) so the marker can never disagree with the
                      content the server already nulled, and a redacted side
                      renders the shared "Redacted" marker instead of the
                      "no input recorded" placeholder. */}
                  <RedactedField
                    field="input"
                    redacted={trace.inputRedacted ?? false}
                    visibleTo={trace.inputVisibleTo}
                  >
                    {trace.input ? (
                      <IOViewer
                        label="Input"
                        content={trace.input}
                        traceId={trace.traceId}
                      />
                    ) : (
                      <MissingIORow label="Input" mode="input" />
                    )}
                  </RedactedField>
                  <RedactedField
                    field="output"
                    redacted={trace.outputRedacted ?? false}
                    visibleTo={trace.outputVisibleTo}
                  >
                    {trace.output ? (
                      <IOViewer
                        label="Output"
                        content={trace.output}
                        mode="output"
                        traceId={trace.traceId}
                      />
                    ) : (
                      <MissingIORow label="Output" mode="output" />
                    )}
                  </RedactedField>
                </VStack>
              </Section>
            );
          }
          if (id === "prompts") {
            return (
              <Section
                key="prompts"
                value="prompts"
                title="Prompts"
                isFirst={isFirst}
                open={isOpen}
              >
                <PromptsPanel
                  trace={trace}
                  spans={spans}
                  onSelectSpan={onSelectSpan ?? (() => undefined)}
                  hideHeader
                />
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
                open={isOpen}
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
                open={isOpen}
              >
                <ScopeBlock scope={resources.scope} />
              </Section>
            );
          }
          if (id === "exceptions") {
            // Show the per-trace exception count in the section title — matches
            // how the Evals and Events sections render their counts. Without
            // this, "Exceptions" was the only erroring section in the drawer
            // without a count, leaving users to expand it to find out whether
            // they were looking at one bad span or twenty.
            const exceptionsCount =
              errorSpans.length +
              (trace.error && errorSpans.length === 0 ? 1 : 0);
            return (
              <Section
                key="exceptions"
                value="exceptions"
                title="Exceptions"
                count={exceptionsCount > 0 ? exceptionsCount : undefined}
                isFirst={isFirst}
                open={isOpen}
              >
                <ExceptionsContent
                  error={trace.error}
                  errorSpans={errorSpans}
                  onSelectSpan={onSelectSpan}
                  onFocusSection={() =>
                    requestFocus({
                      traceId: trace.traceId,
                      section: "exceptions",
                    })
                  }
                />
              </Section>
            );
          }
          if (id === "evals") {
            return (
              <Section
                key="evals"
                value="evals"
                title="Evals"
                spotlightAnchor={hasEvalsContent ? "drawer-evals" : undefined}
                count={
                  evalsForList.length > 0 ? evalsForList.length : undefined
                }
                empty={
                  !evalsLoading &&
                  evalsForList.length === 0 &&
                  pendingCount === 0
                }
                isFirst={isFirst}
                open={isOpen}
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
          if (id === "other") {
            // Empty evals / events / prompts share this one section as a row
            // of compact cards instead of each consuming a full-width
            // accordion — same info, far less vertical space.
            return (
              <Section
                key="other"
                value="other"
                title="Other"
                isFirst={isFirst}
                open={isOpen}
              >
                <HStack align="stretch" gap={2} flexWrap="wrap">
                  {emptyCards.map((card) => {
                    if (card === "evals") {
                      return (
                        <EmptySignalCard
                          key="evals"
                          icon={LuFlaskConical}
                          title="No evals"
                          description="Score traces automatically with evaluators."
                          ctaLabel="Learn more"
                          ctaHref="https://docs.langwatch.ai/evaluations/online-evaluation/overview"
                          isCtaExternal
                        />
                      );
                    }
                    if (card === "events") {
                      return (
                        <EmptySignalCard
                          key="events"
                          icon={LuCalendarClock}
                          title="No events"
                          description="Capture tool calls, feedback, and milestones."
                          ctaLabel="Learn more"
                          ctaHref="https://docs.langwatch.ai/integration/overview"
                          isCtaExternal
                        />
                      );
                    }
                    return (
                      <EmptySignalCard
                        key="prompts"
                        icon={LuFileText}
                        title="No managed prompt"
                        description="Version, test, and reuse prompts across traces."
                        ctaLabel={
                          promptsHref ? "Set up a prompt" : "Learn more"
                        }
                        ctaHref={
                          promptsHref ??
                          "https://docs.langwatch.ai/prompts/template-syntax"
                        }
                        isCtaExternal={!promptsHref}
                      />
                    );
                  })}
                </HStack>
              </Section>
            );
          }
          // events
          return (
            <Section
              key="events"
              value="events"
              title="Events"
              spotlightAnchor={hasEventsContent ? "drawer-events" : undefined}
              count={traceEvents.length}
              isFirst={isFirst}
              open={isOpen}
            >
              <VStack align="stretch" gap={2}>
                {traceEvents.map((evt, i) => (
                  <EventCard
                    key={`${evt.spanId}-${evt.timestamp}-${i}`}
                    name={evt.name}
                    timestampMs={evt.timestamp}
                    anchorMs={trace.timestamp}
                    attributes={evt.attributes}
                    spanId={evt.spanId}
                    onSelectSpan={onSelectSpan}
                  />
                ))}
              </VStack>
            </Section>
          );
        })}
      </AccordionShell>
    </Box>
  );
}

/**
 * Single dim row used in place of an IOViewer when the trace has the
 * other side captured but this one is missing. Lets the user see at a
 * glance that "this trace had an input but no output" rather than us
 * silently hiding the OUTPUT label and leaving them to infer the gap.
 *
 * Kept structurally similar to the IOViewer header (uppercase 2xs label
 * on the left) so the two read as siblings — same hierarchy, just with
 * the body replaced by a muted placeholder.
 */
function MissingIORow({
  label,
  mode,
}: {
  label: string;
  mode: "input" | "output";
}): React.JSX.Element {
  return (
    <HStack gap={2} paddingY={1}>
      <Text
        textStyle="2xs"
        fontWeight="bold"
        color="fg.muted"
        letterSpacing="wide"
        textTransform="uppercase"
      >
        {label}
      </Text>
      <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
        — no {mode} recorded
      </Text>
    </HStack>
  );
}
