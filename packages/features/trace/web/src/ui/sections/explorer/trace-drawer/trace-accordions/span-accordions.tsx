import { Box, HStack, Icon, Skeleton, Spinner, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useMemo, useRef } from "react";
import { LuCircleX } from "react-icons/lu";
import { ContentPrivacyMarkers, PiiIncompleteNotice } from "../../../content-privacy-markers.tsx";
import { RedactedField } from "../../../redacted-field.tsx";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { useAnchoredAnnotations } from "../../hooks/use-anchored-annotations.ts";
import { useSpanDetail } from "../../hooks/use-span-detail.ts";
import { useSpanLogs } from "../../hooks/use-span-logs.ts";
import { useTraceResources } from "../../hooks/use-trace-resources.ts";
import { useDrawerStore } from "../../../../../behavior/drawer.store.ts";
import { type AttributeComments, AttributeTable } from "../attribute-table.tsx";
import { commentCountsBySection } from "../anchored-comments/section-comments.ts";
import { CorrectedFieldFrame } from "../edit-mode/corrected-field.tsx";
import { CorrectedSpanScalars } from "../edit-mode/corrected-span-scalars.tsx";
import { SpanEditableIO } from "../edit-mode/span-editable-io.tsx";
import { SpanNameTypeEditor } from "../edit-mode/span-name-type-editor.tsx";
import { useSpanAttributeEditing } from "../edit-mode/use-span-attribute-editing.ts";
import { useSpanCorrection } from "../edit-mode/use-span-correction.ts";
import { IOViewer } from "../io-viewer.tsx";
import { hasPromptMetadata, PromptAccordion } from "../prompt-accordion.tsx";
import { ScopeBlock } from "../../../../elements/explorer/trace-drawer/scope-chip.tsx";
import { AccordionShell, Section } from "./accordion-shell.tsx";
import {
  EmptyEventsState,
  EmptyHint,
} from "../../../../blocks/explorer/trace-drawer/trace-accordions/empty-states.tsx";
import { EventCard } from "./event-card.tsx";
import {
  logEventTone,
  summarizeLogEvent,
} from "../../../../../model/explorer/trace-drawer/trace-accordions/log-summary.ts";
import { SectionFocusGlow } from "../../../../elements/explorer/trace-drawer/trace-accordions/section-focus-glow.tsx";
import { useAutoOpenSections } from "../../../../../behavior/explorer/trace-drawer/trace-accordions/section-presence.ts";
import { UnmappedCostSuggestion } from "../../../../elements/explorer/trace-drawer/trace-accordions/unmapped-cost-suggestion.tsx";
import { useSectionFocusGlow } from "./use-section-focus-glow.ts";
import { countFlatLeaves } from "../../../../../model/explorer/trace-drawer/trace-accordions/utils.ts";

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
    capturedParams: (detail?.params as Record<string, unknown> | undefined) ?? {},
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

  const {
    attributesStillLoading,
    contentPrivacy,
    hasAttributes,
    hasError,
    hasEvents,
    hasIO,
    hasLogs,
    hasPrivacyMarkers,
    hasPrompt,
    hasResourceAttrs,
    hasScope,
    hasSpanAttrs,
    piiIncomplete,
  } = spanSectionFlags({
    detail,
    isDetailLoading: detailQuery.isLoading,
    isResourcesLoading: resources.isLoading,
    span,
    spanLogs,
    spanResource,
    spanScope,
  });

  const sections = useMemo(
    () => spanSectionIds({ hasError, hasIO, hasLogs, hasPrompt, hasScope }),
    [hasError, hasIO, hasLogs, hasPrompt, hasScope],
  );

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
          {sections.map((id, idx) =>
            spanSectionElement({
              attributeComments,
              attributeEditing,
              attributesStillLoading,
              captured,
              changedFields,
              contentPrivacy,
              detail,
              detailQuery,
              hasAttributes,
              hasEvents,
              hasIO,
              hasPrivacyMarkers,
              hasResourceAttrs,
              id,
              isEditing,
              isFirst: idx === 0,
              isOpen: openSections.includes(id),
              logsLoading,
              piiIncomplete,
              sectionComments,
              span,
              spanLogs,
              spanResource,
              spanScope,
              traceId,
            }),
          )}
        </AccordionShell>
      )}
    </Box>
  );
}

/** One side of a span's captured IO: the editor while editing, else the viewer. */
function SpanIOField({
  corrected,
  detail,
  isEditing,
  mode,
  original,
  traceId,
}: {
  corrected: boolean;
  detail: NonNullable<ReturnType<typeof useSpanDetail>["data"]> | undefined;
  isEditing: boolean;
  mode: "input" | "output";
  original: string | null | undefined;
  traceId: string;
}) {
  if (!detail) return null;
  const label = mode === "input" ? "Input" : "Output";
  const content = detail[mode];

  if (isEditing) {
    return (
      <SpanEditableIO
        spanId={detail.spanId}
        field={mode}
        label={label}
        capturedText={content ?? null}
        capturedParams={mode === "input" ? detail.params : void 0}
      />
    );
  }
  if (content == null) return null;

  return (
    <MaybeCorrected label={label} corrected={corrected} original={original}>
      <IOViewer
        label={label}
        content={content}
        mode={mode}
        traceId={traceId}
        spanId={detail.spanId}
        spanType={detail.type}
      />
    </MaybeCorrected>
  );
}

interface SpanSectionContext {
  attributeComments: AttributeComments;
  attributeEditing: ReturnType<typeof useSpanAttributeEditing>;
  attributesStillLoading: boolean;
  captured: ReturnType<typeof useSpanCorrection>["captured"];
  changedFields: ReturnType<typeof useSpanCorrection>["changedFields"];
  contentPrivacy: NonNullable<ReturnType<typeof useSpanDetail>["data"]>["contentPrivacy"];
  detail: ReturnType<typeof useSpanDetail>["data"];
  detailQuery: ReturnType<typeof useSpanDetail>;
  hasAttributes: boolean;
  hasEvents: boolean;
  hasIO: boolean;
  hasPrivacyMarkers: boolean;
  hasResourceAttrs: boolean;
  id: string;
  isEditing: boolean;
  isFirst: boolean;
  isOpen: boolean;
  logsLoading: boolean;
  piiIncomplete: boolean;
  sectionComments: ReturnType<typeof commentCountsBySection>;
  span: SpanTreeNode;
  spanLogs: ReturnType<typeof useSpanLogs>["logsBySpanId"] extends Map<string, infer L> ? L : never;
  spanResource: ReturnType<typeof useTraceResources>["bySpanId"][string] | null;
  spanScope: NonNullable<ReturnType<typeof useTraceResources>["bySpanId"][string]>["scope"] | null;
  traceId: string;
}

/** The accordion section one id names. */
function spanSectionElement(ctx: SpanSectionContext): ReactNode {
  if (ctx.id === "io") return ioSection(ctx);
  if (ctx.id === "logs") return logsSection(ctx);
  if (ctx.id === "prompt") return promptSection(ctx);
  if (ctx.id === "attributes") return attributesSection(ctx);
  if (ctx.id === "scope") return scopeSection(ctx);
  if (ctx.id === "exceptions") return exceptionsSection(ctx);
  return eventsSection(ctx);
}

/** The span's input and output, with the privacy markers that explain anything hidden. */
function ioSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section
      key="io"
      value="io"
      title="Input and Output"
      commentCount={ctx.sectionComments.io}
      empty={!ctx.detailQuery.isLoading && !ctx.hasIO && !ctx.hasPrivacyMarkers}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {ctx.detailQuery.isLoading ? (
        <EmptyHint>Loading…</EmptyHint>
      ) : (
        <VStack align="stretch" gap={2}>
          {/* Generic per-category privacy markers. Input/output use
          skipRestricted because their hidden state already shows
          inline via RedactedField below; system/tools (no inline
          slot) show every state here. */}
          <ContentPrivacyMarkers
            privacy={ctx.contentPrivacy}
            categories={["input", "output"]}
            skipRestricted
          />
          <ContentPrivacyMarkers
            privacy={ctx.contentPrivacy}
            categories={["system", "tools"]}
            framed
          />
          <PiiIncompleteNotice incomplete={ctx.piiIncomplete} />
          <RedactedField
            field="input"
            redacted={ctx.detail?.inputRedacted ?? false}
            visibleTo={ctx.detail?.inputVisibleTo}
          >
            <SpanIOField
              corrected={ctx.changedFields.includes("input")}
              detail={ctx.detail}
              isEditing={ctx.isEditing}
              mode="input"
              original={ctx.captured?.input}
              traceId={ctx.traceId}
            />
          </RedactedField>
          <RedactedField
            field="output"
            redacted={ctx.detail?.outputRedacted ?? false}
            visibleTo={ctx.detail?.outputVisibleTo}
          >
            <SpanIOField
              corrected={ctx.changedFields.includes("output")}
              detail={ctx.detail}
              isEditing={ctx.isEditing}
              mode="output"
              original={ctx.captured?.output}
              traceId={ctx.traceId}
            />
          </RedactedField>
        </VStack>
      )}
    </Section>
  );
}

/** Events with no span of their own: a denied tool, an API retry, a compaction. */
function logsSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section
      key="logs"
      value="logs"
      title="Logs"
      count={ctx.spanLogs.length}
      commentCount={ctx.sectionComments.logs}
      empty={!ctx.logsLoading && ctx.spanLogs.length === 0}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {ctx.logsLoading ? (
        <EmptyHint>Loading…</EmptyHint>
      ) : (
        <VStack align="stretch" gap={2}>
          {ctx.spanLogs.map((log, i) => {
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
              // Same check the redaction layer applies: some events stamp the
              // event-name marker into the body, overwriting the real content.
              attributes.body = log.body;
            }
            return (
              <EventCard
                key={`${log.timeUnixMs}-${i}`}
                name={summary ?? log.attributes["event.name"] ?? "log"}
                timestampMs={log.timeUnixMs}
                anchorMs={ctx.span.startTimeMs}
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

/** The prompt metadata this span carries, when it carries any. */
function promptSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section key="prompt" value="prompt" title="Prompt" isFirst={ctx.isFirst} open={ctx.isOpen}>
      {ctx.detail && <PromptAccordion span={ctx.detail} />}
    </Section>
  );
}

/** The span's own attributes and its resource attributes, in one table. */
function attributesSection(ctx: SpanSectionContext): ReactNode {
  const attrCount =
    countFlatLeaves(ctx.detail?.params as Record<string, unknown> | undefined) +
    countFlatLeaves(ctx.spanResource?.resourceAttributes);
  return (
    <Section
      key="attributes"
      value="attributes"
      title="Attributes"
      count={attrCount}
      commentCount={ctx.sectionComments.attributes}
      empty={!ctx.hasAttributes && !ctx.isEditing && !ctx.attributesStillLoading}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {!ctx.detailQuery.isLoading && ctx.detail?.costSuggestion && (
        <UnmappedCostSuggestion model={ctx.detail.costSuggestion.model} />
      )}
      {(ctx.hasAttributes || ctx.isEditing) && (
        <AttributeTable
          attributes={ctx.attributeEditing.baselineParams}
          resourceAttributes={
            ctx.hasResourceAttrs ? ctx.spanResource!.resourceAttributes : undefined
          }
          restrictedAttributes={ctx.detail?.restrictedAttributes}
          title="Span Attributes"
          spanId={ctx.detail?.spanId ?? ctx.span.spanId}
          editing={ctx.attributeEditing.editing}
          correctedFrom={
            ctx.changedFields.includes("params")
              ? ((ctx.captured?.params as Record<string, unknown> | undefined) ?? {})
              : undefined
          }
          comments={ctx.attributeComments}
        />
      )}
      {!ctx.hasAttributes && !ctx.isEditing && ctx.attributesStillLoading && (
        <EmptyHint>Loading attributes…</EmptyHint>
      )}
      {!ctx.hasAttributes && !ctx.isEditing && !ctx.attributesStillLoading && (
        <EmptyHint>No additional attributes recorded</EmptyHint>
      )}
    </Section>
  );
}

/** The instrumentation scope that produced the span. */
function scopeSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section
      key="scope"
      value="scope"
      title="Instrumentation Scope"
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      <ScopeBlock scope={ctx.spanScope} />
    </Section>
  );
}

/** The exception the span failed with, and its stack trace. */
function exceptionsSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section
      key="exceptions"
      value="exceptions"
      title="Exceptions"
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {ctx.detail?.error ? (
        <VStack align="stretch" gap={2}>
          <HStack
            gap={2}
            paddingX={3}
            paddingY={2}
            borderRadius="sm"
            bg="red.subtle"
            align="flex-start"
          >
            <Icon as={LuCircleX} boxSize={4} color="red.fg" flexShrink={0} marginTop={0.5} />
            <Text textStyle="xs" color="red.fg" whiteSpace="pre-wrap" fontWeight="semibold">
              {ctx.detail.error.message}
            </Text>
          </HStack>
          {ctx.detail.error.stacktrace.length > 0 && (
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
              {ctx.detail.error.stacktrace.join("\n")}
            </Box>
          )}
        </VStack>
      ) : (
        <EmptyHint>Error status with no exception details</EmptyHint>
      )}
    </Section>
  );
}

/** The span's own recorded events. */
function eventsSection(ctx: SpanSectionContext): ReactNode {
  return (
    <Section
      key="events"
      value="events"
      title="Events"
      count={ctx.hasEvents ? ctx.detail!.events.length : undefined}
      empty={!ctx.detailQuery.isLoading && !ctx.hasEvents}
      isFirst={ctx.isFirst}
      open={ctx.isOpen}
    >
      {ctx.hasEvents ? (
        <VStack align="stretch" gap={2}>
          {ctx.detail!.events.map((evt, i) => (
            <EventCard
              key={`${evt.timestampMs}-${evt.name}-${i}`}
              name={evt.name}
              timestampMs={evt.timestampMs}
              anchorMs={ctx.span.startTimeMs}
              attributes={evt.attributes}
            />
          ))}
        </VStack>
      ) : (
        <EmptyEventsState />
      )}
    </Section>
  );
}

/** What each of the span's sections has to show, decided once for the stack. */
function spanSectionFlags({
  detail,
  isDetailLoading,
  isResourcesLoading,
  span,
  spanLogs,
  spanResource,
  spanScope,
}: {
  detail: ReturnType<typeof useSpanDetail>["data"];
  isDetailLoading: boolean;
  isResourcesLoading: boolean;
  span: SpanTreeNode;
  spanLogs: SpanSectionContext["spanLogs"];
  spanResource: SpanSectionContext["spanResource"];
  spanScope: SpanSectionContext["spanScope"];
}) {
  // Null checks rather than truthiness: a correction can set a field to the
  // empty string, and that is content the section holds, not an absence.
  const hasIO = detail?.input != null || detail?.output != null;
  // Any content category that is dropped, restricted, or restricted-but-visible
  // gives the I/O section something to show even when the content itself is
  // empty, so a fully hidden or dropped span still explains itself.
  const contentPrivacy = detail?.contentPrivacy;
  const piiIncomplete = !!detail?.piiAnalysisIncomplete;
  const hasResourceAttrs =
    !!spanResource && Object.keys(spanResource.resourceAttributes).length > 0;
  const hasSpanAttrs = !!detail?.params && Object.keys(detail.params).length > 0;
  return {
    attributesStillLoading: isResourcesLoading || isDetailLoading,
    contentPrivacy,
    hasAttributes: hasSpanAttrs || hasResourceAttrs,
    hasError: span.status === "error" || !!detail?.error,
    hasEvents: !!detail?.events && detail.events.length > 0,
    hasIO,
    hasLogs: spanLogs.length > 0,
    hasPrivacyMarkers: piiIncomplete || hasHiddenCategory(contentPrivacy),
    // Prompt section only when there is actual prompt metadata. The no-prompt
    // case is covered by the "Open in Playground" affordance on the IOViewer
    // header, so an empty Prompt accordion next to it would add nothing.
    hasPrompt: !!detail && hasPromptMetadata(detail.params),
    hasResourceAttrs,
    hasScope: !!spanScope?.name,
    hasSpanAttrs,
    piiIncomplete,
  };
}

/** Whether any content category is dropped, restricted, or restricted-but-visible. */
function hasHiddenCategory(contentPrivacy: SpanSectionContext["contentPrivacy"]): boolean {
  if (!contentPrivacy) return false;
  return Object.values(contentPrivacy).some(
    (category) => category.state !== "visible" || category.visibleTo != null,
  );
}

/** The sections this span shows, in the order the stack renders them. */
function spanSectionIds({
  hasError,
  hasIO,
  hasLogs,
  hasPrompt,
  hasScope,
}: {
  hasError: boolean;
  hasIO: boolean;
  hasLogs: boolean;
  hasPrompt: boolean;
  hasScope: boolean;
}): string[] {
  const list: string[] = [];
  if (hasError && !hasIO) list.push("exceptions");
  list.push("io");
  if (hasError && hasIO) list.push("exceptions");
  // A tool the reader DENIED, an API retry, a mid-session compaction — none of
  // those produce a span of their own, so this is the only place they show up
  // at all. Placed right after I/O: when a span has logs, that is usually the
  // most interesting thing about it.
  if (hasLogs) list.push("logs");
  if (hasPrompt) list.push("prompt");
  list.push("attributes");
  // Instrumentation scope used to be a chip pinned to the right of the
  // SpanTabBar, which spent tab-row space on metadata most readers glance at
  // once and then ignore.
  if (hasScope) list.push("scope");
  list.push("events");
  return list;
}
