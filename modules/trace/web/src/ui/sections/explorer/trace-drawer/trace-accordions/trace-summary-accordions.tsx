import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useMemo, useRef } from "react";
import { LuCalendarClock, LuFileText, LuFlaskConical } from "react-icons/lu";
import { TraceMediaPart } from "../../../traces/trace-media-part.tsx";
import { PrivacyDroppedNotice } from "../../../privacy-dropped-notice.tsx";
import { RedactedField } from "../../../redacted-field.tsx";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project.ts";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { changedTraceMetadataKeys } from "../../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views.ts";
import { RESERVED_INPUT_MEDIA_REFS, RESERVED_OUTPUT_MEDIA_REFS } from "@langwatch/trace-contract";
import {
  mediaRefBelongsToSide,
  parseMediaRefs,
  type TraceMediaSide,
} from "../../../../../behavior/shared/traces/media-refs.ts";
import { mediaRefToMediaData } from "../../../../../behavior/shared/traces/media-parts.ts";
import { useAnchoredAnnotations } from "../../hooks/use-anchored-annotations.ts";
import { useAppliedTraceEditPatch } from "../../hooks/use-trace-edit-overlay.ts";
import { useTraceEvaluations } from "../../hooks/use-trace-evaluations.ts";
import { useTraceEvents } from "../../hooks/use-trace-events.ts";
import { useTraceHeaderCanonical } from "../../hooks/use-trace-header.ts";
import { useTraceResources } from "../../hooks/use-trace-resources.ts";
import { useDrawerStore } from "../../../../../behavior/drawer.store.ts";
import { useFocusSectionStore } from "../../../../../behavior/focus-section.store.ts";
import { rankedErrorSpans } from "../../../../../model/explorer/error-spans.ts";
import { type AttributeComments, AttributeTable } from "../attribute-table.tsx";
import { commentCountsBySection } from "../anchored-comments/section-comments.ts";
import { ExceptionsContent } from "../../../../elements/explorer/trace-drawer/exceptions-content.tsx";
import { CorrectedFieldFrame } from "../edit-mode/corrected-field.tsx";
import { TraceEditableInput } from "../edit-mode/trace-editable-input.tsx";
import { TraceEditableOutput } from "../edit-mode/trace-editable-output.tsx";
import { useTraceMetadataEditing } from "../edit-mode/use-trace-metadata-editing.ts";
import { EvalsList } from "../eval-cards/index.ts";
import { IOViewer } from "../io-viewer.tsx";
import { PromptsPanel } from "../prompts-panel.tsx";
import { ScopeBlock } from "../../../../elements/explorer/trace-drawer/scope-chip.tsx";
import { AccordionShell, Section } from "./accordion-shell.tsx";
import {
  EmptyHint,
  EmptySignalCard,
} from "../../../../blocks/explorer/trace-drawer/trace-accordions/empty-states.tsx";
import { EventCard } from "./event-card.tsx";
import { SectionFocusGlow } from "../../../../elements/explorer/trace-drawer/trace-accordions/section-focus-glow.tsx";
import { useAutoOpenSections } from "../../../../../behavior/explorer/trace-drawer/trace-accordions/section-presence.ts";
import { useSectionFocusGlow } from "./use-section-focus-glow.ts";
import { countFlatLeaves } from "../../../../../model/explorer/trace-drawer/trace-accordions/utils.ts";

export function TraceSummaryAccordions({
  trace,
  spans,
  onSelectSpan,
}: {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const isEditing = useDrawerStore((s) => s.isEditing);
  // The trace's own input, output and metadata are what a correction can
  // replace at trace level, so they are the fields that carry the corrected
  // treatment here.
  const appliedPatch = useAppliedTraceEditPatch();
  const inputCorrected = appliedPatch?.trace?.input !== undefined;
  const outputCorrected = appliedPatch?.trace?.output !== undefined;
  const metadataCorrected = changedTraceMetadataKeys(appliedPatch).length > 0;
  const canonicalHeader = useTraceHeaderCanonical().data;
  // `keepPreviousData` leaves the previous trace's header in place until the
  // new read lands, so the captured value is only this trace's while the two
  // agree on which trace it belongs to.
  const isCanonicalThisTrace = canonicalHeader?.traceId === trace.traceId;
  const capturedInput = isCanonicalThisTrace ? canonicalHeader.input : undefined;
  const capturedOutput = isCanonicalThisTrace ? canonicalHeader.output : undefined;
  const { hasIO, hasRedactedIO } = traceIOFlags(trace);
  // The media_refs reserved attributes are rendering plumbing (consumed by
  // the media strips below and the table's preview column) — as metadata
  // rows they are two long JSON blobs that drown the real attributes.
  const traceAttributes = useMemo(
    () => filterReservedMediaRefAttributes(trace.attributes ?? {}),
    [trace.attributes],
  );
  const capturedAttributes = useMemo(
    () =>
      isCanonicalThisTrace
        ? filterReservedMediaRefAttributes(canonicalHeader.attributes ?? {})
        : undefined,
    [isCanonicalThisTrace, canonicalHeader],
  );
  const metadataEditing = useTraceMetadataEditing({
    capturedAttributes: traceAttributes,
    enabled: isEditing,
  });
  // Trace-level events are read as their own query (like evaluations), not off
  // the header: the fold no longer carries them, so they're derived from
  // stored_spans on demand. Includes legacy `/track-event` payloads, which the
  // SDK attaches to a synthetic span as OTel span events.
  const { events: traceEvents, isLoading: eventsLoading } = useTraceEvents();
  const { project } = useOrganizationTeamProject();
  const promptsHref = project?.slug ? `/${project.slug}/prompts` : undefined;
  const resources = useTraceResources(trace.traceId);
  const { hasAttributes, hasResourceAttributes, hasScope, hasTraceAttributes } =
    traceAttributeFlags({ resources, traceAttributes });

  const { rich: richEvals, pendingCount, isLoading: evalsLoading } = useTraceEvaluations();

  // What has been said about the trace's own parts: a count on each section
  // header, and the comments each metadata row carries.
  const annotations = useAnchoredAnnotations();
  const sectionComments = useMemo(
    () =>
      commentCountsBySection({
        comments: annotations.all,
        anchorId: trace.traceId,
      }),
    [annotations.all, trace.traceId],
  );
  const metadataComments = useMemo<AttributeComments>(
    () => ({
      traceId: trace.traceId,
      anchorId: trace.traceId,
      pathPrefix: "metadata",
      commentsFor: (anchorPath) =>
        annotations.commentsAt({
          anchorKind: "field",
          anchorId: trace.traceId,
          anchorPath,
        }),
    }),
    [trace.traceId, annotations],
  );

  const evalsForList = useMemo(
    () =>
      richEvals.map((e) => ({
        ...e,
        spanName: e.spanId ? spans.find((s) => s.spanId === e.spanId)?.name : undefined,
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
  const { evalsEmpty, eventsEmpty, hasError, hasEvalsContent, hasEventsContent, promptsEmpty } =
    traceSignalFlags({
      errorSpans,
      evalsForList,
      evalsLoading,
      eventsLoading,
      pendingCount,
      trace,
      traceEvents,
    });

  // Empty signals collapse into one shared "Other" section as compact cards
  // rather than each eating a full-width accordion. Ordered evals → events →
  // prompts to mirror their normal section order.
  const emptyCards = useMemo(
    () => emptySignalCards({ evalsEmpty, eventsEmpty, promptsEmpty }),
    [evalsEmpty, eventsEmpty, promptsEmpty],
  );
  const showOther = emptyCards.length > 0;

  const sections = useMemo(
    () =>
      traceSectionIds({
        containsPrompt: trace.containsPrompt,
        hasError,
        hasEvalsContent,
        hasEventsContent,
        hasIO,
        showOther,
      }),
    [hasIO, hasError, trace.containsPrompt, hasEvalsContent, hasEventsContent, showOther],
  );

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
        {sections.map((id, idx) =>
          traceSectionElement({
            capturedAttributes,
            capturedInput,
            capturedOutput,
            emptyCards,
            errorSpans,
            evalsForList,
            evalsLoading,
            hasAttributes,
            hasEvalsContent,
            hasEventsContent,
            hasIO,
            hasRedactedIO,
            hasResourceAttributes,
            hasTraceAttributes,
            id,
            inputCorrected,
            isEditing,
            isFirst: idx === 0,
            isOpen: openSections.includes(id),
            metadataComments,
            metadataCorrected,
            metadataEditing,
            onSelectSpan,
            outputCorrected,
            pendingCount,
            promptsHref,
            requestFocus,
            resources,
            sectionComments,
            spans,
            trace,
            traceAttributes,
            traceEvents,
          }),
        )}
      </AccordionShell>
    </Box>
  );
}

/**
 * Single dim row used in place of an IOViewer when this side is missing but the other is captured.
 */
export function filterReservedMediaRefAttributes(
  attributes: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !key.startsWith("langwatch.reserved.media_refs.")),
  );
}

/**
 * Media widgets for the fold-derived media refs riding the summary's reserved attributes — the
 * trace-level input/output are flattened text, so this is how media from the winning span surfaces.
 */
export function SummaryMediaStrip({
  refsJson,
  side,
}: {
  refsJson: string | undefined;
  side: TraceMediaSide;
}): React.JSX.Element | null {
  const refs = useMemo(
    () => parseMediaRefs(refsJson).filter((ref) => mediaRefBelongsToSide(ref, side)),
    [refsJson, side],
  );
  if (refs.length === 0) return null;
  return (
    <VStack align="flex-start" gap={2} paddingTop={2}>
      {refs.map((ref, i) => (
        <TraceMediaPart key={`${ref.url}-${i}`} part={mediaRefToMediaData(ref)} />
      ))}
    </VStack>
  );
}

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

/** The trace's input: the editor, the correction frame, the viewer, or nothing recorded. */
function TraceInputField({
  capturedInput,
  inputCorrected,
  isEditing,
  trace,
}: {
  capturedInput: string | null | undefined;
  inputCorrected: boolean;
  isEditing: boolean;
  trace: TraceHeader;
}) {
  if (isEditing) return <TraceEditableInput capturedText={trace.input ?? null} />;
  if (!trace.input) return <MissingIORow label="Input" mode="input" />;

  const viewer = <IOViewer label="Input" content={trace.input} traceId={trace.traceId} />;
  if (!inputCorrected) return viewer;

  return (
    <CorrectedFieldFrame label="Input" original={capturedInput}>
      {viewer}
    </CorrectedFieldFrame>
  );
}

/** The trace's output, in the same four shapes as the input above. */
function TraceOutputField({
  capturedOutput,
  isEditing,
  outputCorrected,
  trace,
}: {
  capturedOutput: string | null | undefined;
  isEditing: boolean;
  outputCorrected: boolean;
  trace: TraceHeader;
}) {
  if (isEditing) return <TraceEditableOutput capturedText={trace.output ?? null} />;
  if (!trace.output) return <MissingIORow label="Output" mode="output" />;

  const viewer = (
    <IOViewer label="Output" content={trace.output} mode="output" traceId={trace.traceId} />
  );
  if (!outputCorrected) return viewer;

  return (
    <CorrectedFieldFrame label="Output" original={capturedOutput}>
      {viewer}
    </CorrectedFieldFrame>
  );
}

interface TraceSectionContext {
  capturedAttributes: Record<string, unknown> | undefined;
  capturedInput: string | null | undefined;
  capturedOutput: string | null | undefined;
  emptyCards: Array<"evals" | "events" | "prompts">;
  errorSpans: ReturnType<typeof rankedErrorSpans>;
  evalsForList: Array<
    ReturnType<typeof useTraceEvaluations>["rich"][number] & { spanName?: string }
  >;
  evalsLoading: boolean;
  hasAttributes: boolean;
  hasEvalsContent: boolean;
  hasEventsContent: boolean;
  hasIO: boolean;
  hasRedactedIO: boolean;
  hasResourceAttributes: boolean;
  hasTraceAttributes: boolean;
  id: string;
  inputCorrected: boolean;
  outputCorrected: boolean;
  isEditing: boolean;
  isFirst: boolean;
  isOpen: boolean;
  metadataComments: AttributeComments;
  metadataCorrected: boolean;
  metadataEditing: ReturnType<typeof useTraceMetadataEditing>;
  onSelectSpan?: (spanId: string) => void;
  pendingCount: number;
  promptsHref: string | undefined;
  requestFocus: ReturnType<typeof useFocusSectionStore.getState>["request"];
  resources: ReturnType<typeof useTraceResources>;
  sectionComments: ReturnType<typeof commentCountsBySection>;
  spans: SpanTreeNode[];
  trace: TraceHeader;
  traceAttributes: Record<string, unknown>;
  traceEvents: ReturnType<typeof useTraceEvents>["events"];
}

/** The accordion section one id names. */
function traceSectionElement(ctx: TraceSectionContext): ReactNode {
  if (ctx.id === "io") return ioTraceSection(ctx);
  if (ctx.id === "prompts") return promptsTraceSection(ctx);
  if (ctx.id === "attributes") return attributesTraceSection(ctx);
  if (ctx.id === "scope") return scopeTraceSection(ctx);
  if (ctx.id === "exceptions") return exceptionsTraceSection(ctx);
  if (ctx.id === "evals") return evalsTraceSection(ctx);
  if (ctx.id === "other") return otherTraceSection(ctx);
  return eventsTraceSection(ctx);
}

/** The trace's own input and output, with the media strips and redaction markers. */
function ioTraceSection(ctx: TraceSectionContext): ReactNode {
  return (
    <Section
      key="io"
      value="io"
      title="Input and Output"
      commentCount={ctx.sectionComments.io}
      // Redacted content is hidden, not absent — don't tag the section
      // "empty" when a privacy rule nulled the I/O.
      empty={!ctx.hasIO && !ctx.hasRedactedIO}
      spotlightAnchor={ctx.hasIO ? "drawer-io" : undefined}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      <VStack align="stretch" gap={2}>
        <PrivacyDroppedNotice categories={ctx.trace.privacy?.droppedCategories ?? undefined} />
        {/* Drive redaction off the header DTO's own flags (like the
          span path) so the marker can never disagree with the
          content the server already nulled, and a redacted side
          renders the shared "Redacted" marker instead of the
          "no input recorded" placeholder. */}
        <RedactedField
          field="input"
          redacted={ctx.trace.inputRedacted ?? false}
          visibleTo={ctx.trace.inputVisibleTo}
        >
          <TraceInputField
            capturedInput={ctx.capturedInput}
            inputCorrected={ctx.inputCorrected}
            isEditing={ctx.isEditing}
            trace={ctx.trace}
          />
          <SummaryMediaStrip
            refsJson={ctx.trace.attributes?.[RESERVED_INPUT_MEDIA_REFS]}
            side="input"
          />
        </RedactedField>
        <RedactedField
          field="output"
          redacted={ctx.trace.outputRedacted ?? false}
          visibleTo={ctx.trace.outputVisibleTo}
        >
          <TraceOutputField
            capturedOutput={ctx.capturedOutput}
            isEditing={ctx.isEditing}
            outputCorrected={ctx.outputCorrected}
            trace={ctx.trace}
          />
          <SummaryMediaStrip
            refsJson={ctx.trace.attributes?.[RESERVED_OUTPUT_MEDIA_REFS]}
            side="output"
          />
        </RedactedField>
      </VStack>
    </Section>
  );
}

/** The managed prompts this trace used. */
function promptsTraceSection(ctx: TraceSectionContext): ReactNode {
  return (
    <Section key="prompts" value="prompts" title="Prompts" isFirst={ctx.isFirst} open={ctx.isOpen}>
      <PromptsPanel
        trace={ctx.trace}
        spans={ctx.spans}
        onSelectSpan={ctx.onSelectSpan ?? (() => undefined)}
        hideHeader
      />
    </Section>
  );
}

/** The trace's metadata and the resource attributes behind it. */
function attributesTraceSection(ctx: TraceSectionContext): ReactNode {
  const attrCount =
    countFlatLeaves(ctx.traceAttributes) + countFlatLeaves(ctx.resources.resourceAttributes);
  return (
    <Section
      key="attributes"
      value="attributes"
      title="Metadata"
      count={attrCount}
      commentCount={ctx.sectionComments.attributes}
      empty={!ctx.hasAttributes && !ctx.isEditing && !ctx.resources.isLoading}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {(ctx.hasAttributes || ctx.isEditing) && (
        <AttributeTable
          attributes={ctx.metadataEditing.baselineAttributes}
          resourceAttributes={
            ctx.hasResourceAttributes ? ctx.resources.resourceAttributes : undefined
          }
          title="Trace Attributes"
          editing={ctx.metadataEditing.editing}
          correctedFrom={ctx.metadataCorrected ? ctx.capturedAttributes : undefined}
          comments={ctx.metadataComments}
        />
      )}
      {!ctx.hasAttributes && !ctx.isEditing && ctx.resources.isLoading && (
        <EmptyHint>Loading metadata…</EmptyHint>
      )}
      {!ctx.hasAttributes && !ctx.isEditing && !ctx.resources.isLoading && (
        <EmptyHint>No metadata recorded</EmptyHint>
      )}
    </Section>
  );
}

/** The instrumentation scope the trace was produced by. */
function scopeTraceSection(ctx: TraceSectionContext): ReactNode {
  return (
    <Section
      key="scope"
      value="scope"
      title="Instrumentation Scope"
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      <ScopeBlock scope={ctx.resources.scope} />
    </Section>
  );
}

/** The trace-level error and the spans that failed under it. */
function exceptionsTraceSection(ctx: TraceSectionContext): ReactNode {
  // Show the per-ctx.trace exception count in the section title — matches
  // how the Evals and Events sections render their counts. Without
  // this, "Exceptions" was the only erroring section in the drawer
  // without a count, leaving users to expand it to find out whether
  // they were looking at one bad span or twenty.
  const exceptionsCount =
    ctx.errorSpans.length + (ctx.trace.error && ctx.errorSpans.length === 0 ? 1 : 0);
  return (
    <Section
      key="exceptions"
      value="exceptions"
      title="Exceptions"
      count={exceptionsCount > 0 ? exceptionsCount : undefined}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      <ExceptionsContent
        error={ctx.trace.error}
        errorSpans={ctx.errorSpans}
        onSelectSpan={ctx.onSelectSpan}
        onFocusSection={() =>
          ctx.requestFocus({
            traceId: ctx.trace.traceId,
            section: "exceptions",
          })
        }
      />
    </Section>
  );
}

/** The evaluations that ran against this trace. */
function evalsTraceSection(ctx: TraceSectionContext): ReactNode {
  return (
    <Section
      key="evals"
      value="evals"
      title="Evals"
      spotlightAnchor={ctx.hasEvalsContent ? "drawer-evals" : undefined}
      count={ctx.evalsForList.length > 0 ? ctx.evalsForList.length : undefined}
      empty={!ctx.evalsLoading && ctx.evalsForList.length === 0 && ctx.pendingCount === 0}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {ctx.evalsLoading ? (
        <EmptyHint>Loading evaluations…</EmptyHint>
      ) : (
        <VStack align="stretch" gap={2}>
          {ctx.pendingCount > 0 && (
            <Text textStyle="xs" color="fg.muted">
              {ctx.pendingCount} evaluation{ctx.pendingCount === 1 ? "" : "s"} pending
            </Text>
          )}
          <EvalsList evals={ctx.evalsForList} onSelectSpan={ctx.onSelectSpan} />
        </VStack>
      )}
    </Section>
  );
}

/** Signals that settled with nothing, as compact cards rather than empty sections. */
function otherTraceSection(ctx: TraceSectionContext): ReactNode {
  // Empty evals / events / prompts share this one section as a row
  // of compact cards instead of each consuming a full-width
  // accordion — same info, far less vertical space.
  return (
    <Section key="other" value="other" title="Other" isFirst={ctx.isFirst} open={ctx.isOpen}>
      <HStack align="stretch" gap={2} flexWrap="wrap">
        {ctx.emptyCards.map((card) => {
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
              ctaLabel={ctx.promptsHref ? "Set up a prompt" : "Learn more"}
              ctaHref={ctx.promptsHref ?? "https://docs.langwatch.ai/prompts/template-syntax"}
              isCtaExternal={!ctx.promptsHref}
            />
          );
        })}
      </HStack>
    </Section>
  );
}

/** The trace's own events, including legacy track-event payloads. */
function eventsTraceSection(ctx: TraceSectionContext): ReactNode {
  return (
    <Section
      key="events"
      value="events"
      title="Events"
      spotlightAnchor={ctx.hasEventsContent ? "drawer-events" : undefined}
      count={ctx.traceEvents.length}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      <VStack align="stretch" gap={2}>
        {ctx.traceEvents.map((evt, i) => (
          <EventCard
            key={`${evt.spanId}-${evt.timestamp}-${i}`}
            name={evt.name}
            timestampMs={evt.timestamp}
            anchorMs={ctx.trace.timestamp}
            attributes={evt.attributes}
            spanId={evt.spanId}
            onSelectSpan={ctx.onSelectSpan}
          />
        ))}
      </VStack>
    </Section>
  );
}

/**
 * Empty signals collapse into one shared "Other" section as compact cards
 * rather than each eating a full-width accordion. Ordered evals, events then
 * prompts, mirroring their normal section order.
 */
function emptySignalCards({
  evalsEmpty,
  eventsEmpty,
  promptsEmpty,
}: {
  evalsEmpty: boolean;
  eventsEmpty: boolean;
  promptsEmpty: boolean;
}): Array<"evals" | "events" | "prompts"> {
  const cards: Array<"evals" | "events" | "prompts"> = [];
  if (evalsEmpty) cards.push("evals");
  if (eventsEmpty) cards.push("events");
  if (promptsEmpty) cards.push("prompts");
  return cards;
}

/** The sections the trace summary shows, in the order the stack renders them. */
function traceSectionIds({
  containsPrompt,
  hasError,
  hasEvalsContent,
  hasEventsContent,
  hasIO,
  showOther,
}: {
  containsPrompt: boolean | undefined;
  hasError: boolean;
  hasEvalsContent: boolean;
  hasEventsContent: boolean;
  hasIO: boolean;
  showOther: boolean;
}): Array<"io" | "prompts" | "attributes" | "scope" | "evals" | "events" | "exceptions" | "other"> {
  const list: Array<
    "io" | "prompts" | "attributes" | "scope" | "evals" | "events" | "exceptions" | "other"
  > = [];
  if (hasError && !hasIO) list.push("exceptions");
  list.push("io");
  if (hasError && hasIO) list.push("exceptions");
  // Prompts the trace used — the span-level Prompt accordion only shows when a
  // span is selected, so the trace summary surfaced no prompt information even
  // when spans carried managed prompts. `containsPrompt` is the cheap
  // trace-level precondition; without it the prompt call to action moves into
  // the shared "Other" section.
  if (containsPrompt) list.push("prompts");
  list.push("attributes");
  // Evals and Events render as their own full-width section only once their
  // query has content. A confirmed-empty one drops into "Other" as a compact
  // card; while a query is still loading the signal is simply absent, so it
  // never flashes a full-width empty state on the way to becoming a card.
  if (hasEvalsContent) list.push("evals");
  if (hasEventsContent) list.push("events");
  if (showOther) list.push("other");
  return list;
}

/**
 * A restrict privacy rule hides content the viewer may not see: the server
 * nulls `input`/`output` and sets these flags. The I/O section then reads as
 * "Redacted", not "empty" — there IS content, it is just hidden.
 */
function traceIOFlags(trace: TraceHeader): { hasIO: boolean; hasRedactedIO: boolean } {
  return {
    hasIO: !!(trace.input || trace.output),
    hasRedactedIO: !!(trace.inputRedacted || trace.outputRedacted),
  };
}

/** What the Metadata and Scope sections have to show. */
function traceAttributeFlags({
  resources,
  traceAttributes,
}: {
  resources: ReturnType<typeof useTraceResources>;
  traceAttributes: Record<string, unknown>;
}): {
  hasAttributes: boolean;
  hasResourceAttributes: boolean;
  hasScope: boolean;
  hasTraceAttributes: boolean;
} {
  const hasResourceAttributes = Object.keys(resources.resourceAttributes).length > 0;
  const hasTraceAttributes = Object.keys(traceAttributes).length > 0;
  return {
    hasAttributes: hasTraceAttributes || hasResourceAttributes,
    hasResourceAttributes,
    hasScope: !!resources.scope?.name,
    hasTraceAttributes,
  };
}

/**
 * A signal counts as "empty" — and so becomes a compact card — only once its
 * query has settled with nothing. While it is still loading it is neither a full
 * section nor a card, simply absent, so it never flashes a full-width empty
 * state before settling.
 */
function traceSignalFlags({
  errorSpans,
  evalsForList,
  evalsLoading,
  eventsLoading,
  pendingCount,
  trace,
  traceEvents,
}: {
  errorSpans: ReturnType<typeof rankedErrorSpans>;
  evalsForList: TraceSectionContext["evalsForList"];
  evalsLoading: boolean;
  eventsLoading: boolean;
  pendingCount: number;
  trace: TraceHeader;
  traceEvents: TraceSectionContext["traceEvents"];
}): {
  evalsEmpty: boolean;
  eventsEmpty: boolean;
  hasError: boolean;
  hasEvalsContent: boolean;
  hasEventsContent: boolean;
  promptsEmpty: boolean;
} {
  const hasEvalsContent = evalsForList.length > 0 || pendingCount > 0;
  const hasEventsContent = traceEvents.length > 0;
  return {
    evalsEmpty: !hasEvalsContent && !evalsLoading,
    eventsEmpty: !hasEventsContent && !eventsLoading,
    // The Exceptions section shows whenever an error trace has either a
    // trace-level error string or at least one errored span. The latter matters
    // for traces with only span-level failures, where the header chip would
    // otherwise list pills leading to a section gate that never opens.
    hasError: trace.status === "error" && (!!trace.error || errorSpans.length > 0),
    hasEvalsContent,
    hasEventsContent,
    promptsEmpty: !trace.containsPrompt,
  };
}
