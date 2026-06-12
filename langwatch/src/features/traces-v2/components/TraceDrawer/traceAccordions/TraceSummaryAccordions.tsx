import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useRef } from "react";
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
import { ScopeBlock } from "../ScopeChip";
import { AccordionShell, Section } from "./AccordionShell";
import { EmptyEventsState, EmptyHint } from "./EmptyStates";
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
  const traceAttributes = trace.attributes ?? {};
  // Trace-level events are read as their own query (like evaluations), not off
  // the header: the fold no longer carries them, so they're derived from
  // stored_spans on demand. Includes legacy `/track-event` payloads, which the
  // SDK attaches to a synthetic span as OTel span events.
  const { events: traceEvents } = useTraceEvents();
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
                empty={!hasIO}
                spotlightAnchor={hasIO ? "drawer-io" : undefined}
                isFirst={isFirst}
                open={isOpen}
              >
                {hasIO ? (
                  <VStack align="stretch" gap={2}>
                    {trace.input ? (
                      <IOViewer
                        label="Input"
                        content={trace.input}
                        traceId={trace.traceId}
                      />
                    ) : (
                      <MissingIORow label="Input" mode="input" />
                    )}
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
          // events
          return (
            <Section
              key="events"
              value="events"
              title="Events"
              spotlightAnchor={hasEventsContent ? "drawer-events" : undefined}
              count={traceEvents.length > 0 ? traceEvents.length : undefined}
              empty={traceEvents.length === 0}
              isFirst={isFirst}
              open={isOpen}
            >
              {traceEvents.length > 0 ? (
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
