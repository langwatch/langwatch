/**
 * The mapping and redaction layer both trace-view transports share.
 *
 * `tracesV2.*` (authenticated) and `sharedTrace.get` (the one anonymous read
 * ADR-057 allows) render the same trace out of the same rows. Every mapper
 * here is applied by BOTH, which is the point: a redaction added to one and
 * forgotten in the other silently leaks to share viewers, so there is exactly
 * one implementation and both doors go through it.
 *
 * It sits under `transport/api-trpc/` beside the gates for the same reason those do
 * (see `trace-view-gates.api.ts`): it is transport-shaped presentation, not a
 * service, and strict layout version 0 admits nothing else here.
 *
 * ## What arrives as a port
 *
 * Three capabilities are the APPLICATION'S, not Trace's, and arrive as
 * arguments rather than imports:
 *
 *   - how a span's captured input/output is rendered as display text,
 *   - the legacy span-protection pass and its redaction extraction,
 *   - the data-privacy vertical's content-key catalog, its per-span markers
 *     and its chat-turn stripper.
 *
 * Each one belongs to a vertical this package does not own. Injecting them
 * keeps the mapping here without dragging three other features' modules along
 * with it.
 */
import { CONTENT_CATEGORIES, type ContentCategory } from "@langwatch/data-privacy-contract";
import type {
  ContentPrivacy,
  DerivedTraceEvent,
  Span,
  SpanDetail,
  SpanInputOutput,
  SpanTreeNode,
  SpanSummaryRow,
  TraceHeader,
  TraceListItem,
  TraceLogRecordDto,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import {
  deriveTraceStatus,
  deriveTraceTimestamp,
  RESERVED_INPUT_MEDIA_REFS,
  RESERVED_OUTPUT_MEDIA_REFS,
  resolveNonBilledCost,
} from "@langwatch/trace-contract";
import type { CodingAgentService, LogContentCategory } from "@langwatch/coding-agent-contract";
import { TraceAttributeRedactor } from "../../services/trace-attribute-redaction.service";
import type {
  CategoryVisibility,
  Protections,
} from "../../services/trace-viewer-protections.service";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** How a span's captured input/output becomes the text the drawer renders. */
export type TraceSpanDisplayPort = Readonly<{
  buildDisplayInput(span: Pick<Span, "input" | "params">): string | null;
  stringifySpanIO(io: SpanInputOutput | null | undefined): string | null;
}>;

/**
 * The legacy span-protection pass: the one that redacts a span's own
 * input/output, strips its metrics behind `cost:view`, and scrubs hidden
 * content wherever it rides along inside `params` and events.
 */
export type TraceSpanProtectionPort = Readonly<{
  applySpanProtections(span: Span, protections: Protections, redactions: Set<string>): Span;
  extractRedactionsFromAllSpanInputs(spans: Span[]): string[];
  extractRedactionsFromAllSpanOutputs(spans: Span[]): string[];
  redactObject<T>(object: T, redactions: Set<string>): T;
  applyDerivedTraceEventProtections(
    events: DerivedTraceEvent[],
    protections: Protections,
  ): DerivedTraceEvent[];
}>;

/**
 * The data-privacy vertical's read-side vocabulary: which attribute keys carry
 * each content category, the per-span markers ingestion stamps, and the
 * conversation rewriter that removes hidden chat turns.
 */
export type TraceContentPrivacyPort = Readonly<{
  /** Built-in span-attribute keys per content category. */
  contentKeyCatalog: Record<ContentCategory, readonly string[]>;
  /** Attribute naming the categories ingestion dropped from this span. */
  droppedMarkerAttribute: string;
  /** Attribute marking a span whose strict-PII pass did not complete. */
  piiIncompleteMarkerAttribute: string;
  /** Removes hidden roles / tool calls from a JSON-encoded conversation. */
  stripRolesFromChatArrayJson(
    json: string,
    roles: ReadonlySet<string>,
    stripToolCalls: boolean,
  ): { json: string; removed: number } | null;
  /**
   * The project's resolved data-privacy policy, for the trace-level DROP
   * banner. Only the four categories' dispositions are read.
   */
  getResolvedPolicyForProject(input: {
    projectId: string;
  }): Promise<{ categories: Record<ContentCategory, { disposition: string }> }>;
}>;

/** The three application capabilities the trace-view mappers take. */
export type TraceReadMapperPorts = Readonly<{
  spanDisplay: TraceSpanDisplayPort;
  spanProtection: TraceSpanProtectionPort;
  contentPrivacy: TraceContentPrivacyPort;
}>;

// ---------------------------------------------------------------------------
// Span tree
// ---------------------------------------------------------------------------

/**
 * The legacy whole-tree and shared-trace transports still read their own
 * bounded summary anchor. Cursor-paged and delta reads use TraceService.
 */
export function mapLegacySpanSummaryToTreeNode(row: SpanSummaryRow): SpanTreeNode {
  let status: SpanTreeNode["status"] = "unset";
  if (row.statusCode === 2) {
    status = "error";
  } else if (row.statusCode === 1) {
    status = "ok";
  }

  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    name: row.spanName,
    type: row.spanType,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.startTimeMs + row.durationMs,
    durationMs: row.durationMs,
    status,
    model: row.model,
    toolName: row.toolName,
    cost: row.cost,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    updatedAtMs: row.updatedAtMs,
  };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function mapTraceSummaryToHeader(summary: TraceSummaryData): TraceHeader {
  const totalTokens =
    (summary.totalPromptTokenCount ?? 0) + (summary.totalCompletionTokenCount ?? 0);

  const status = deriveTraceStatus(summary);

  const nonBilledCost = resolveNonBilledCost({
    foldedNonBilledCost: summary.nonBilledCost,
    totalCost: summary.totalCost,
    attributes: summary.attributes,
  });

  return {
    traceId: summary.traceId,
    timestamp: deriveTraceTimestamp({
      occurredAt: summary.occurredAt,
      storageAnchorMs: summary.storageAnchorMs,
    }),
    name: summary.attributes["langwatch.span.name"] ?? summary.traceId.slice(0, 8),
    serviceName: summary.attributes["service.name"] ?? "",
    origin: summary.attributes["langwatch.origin"] ?? "application",
    conversationId:
      summary.attributes["gen_ai.conversation.id"] ??
      summary.attributes["langgraph.thread_id"] ??
      null,
    userId: summary.attributes["langwatch.user_id"] ?? null,
    durationMs: summary.totalDurationMs,
    spanCount: summary.spanCount,
    status,
    error: summary.errorMessage,
    input: summary.computedInput,
    output: summary.computedOutput,
    redactedByVisibilityWindow: summary.redactedByVisibilityWindow,
    models: summary.models,
    totalCost: summary.totalCost,
    nonBilledCost,
    totalTokens,
    inputTokens: summary.totalPromptTokenCount,
    outputTokens: summary.totalCompletionTokenCount,
    tokensEstimated: summary.tokensEstimated,
    ttft: summary.timeToFirstTokenMs,
    traceName: summary.traceName,
    rootSpanType: summary.rootSpanType,
    scenarioRunId: summary.attributes["scenario.run_id"] ?? null,
    containsPrompt: summary.containsPrompt ?? false,
    selectedPromptId: summary.selectedPromptId ?? null,
    selectedPromptSpanId: summary.selectedPromptSpanId ?? null,
    lastUsedPromptId: summary.lastUsedPromptId ?? null,
    lastUsedPromptVersionNumber: summary.lastUsedPromptVersionNumber ?? null,
    lastUsedPromptVersionId: summary.lastUsedPromptVersionId ?? null,
    lastUsedPromptSpanId: summary.lastUsedPromptSpanId ?? null,
    attributes: summary.attributes,
  };
}

/**
 * Trace-level DROP banner. A `drop` disposition strips the category at
 * ingestion, so the computed content was never stored and is empty. The check
 * uses the ORIGINAL computed content (the pre-redaction header), not the
 * redacted one: an old pre-rule trace still has its content, so the banner
 * won't show even though the now-`drop` policy hides it; restricted content
 * has disposition "restrict" (not "drop") so it can't be mislabeled here.
 * Resolution failures must not break the header — the derivation just yields
 * no banner. Shared by the internal `tracesV2.header` read and the anonymous
 * share payload (`sharedTrace.get`). See ADR-057.
 */
export async function deriveTraceDropPrivacy(
  rawHeader: Pick<TraceHeader, "input" | "output">,
  projectId: string,
  contentPrivacy: TraceContentPrivacyPort,
): Promise<TraceHeader["privacy"]> {
  try {
    const policy = await contentPrivacy.getResolvedPolicyForProject({ projectId });
    const droppedCategories: string[] = [];
    if (policy.categories.input.disposition === "drop" && !rawHeader.input) {
      droppedCategories.push("input");
    }
    if (policy.categories.output.disposition === "drop" && !rawHeader.output) {
      droppedCategories.push("output");
    }
    return droppedCategories.length > 0 ? { droppedCategories } : null;
  } catch {
    // Skip the drop derivation on resolver/cache/db failure.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Span detail
// ---------------------------------------------------------------------------

export function mapSpanToDetail(
  span: Span,
  rawEvents: Array<{
    name: string;
    timeUnixMs: number;
    attributes: Record<string, unknown>;
  }>,
  spanDisplay: TraceSpanDisplayPort,
): SpanDetail {
  let status: SpanDetail["status"] = "unset";
  if (span.error) status = "error";
  else if (span.timestamps.finished_at > 0) status = "ok";

  return {
    spanId: span.span_id,
    parentSpanId: span.parent_id ?? null,
    name: span.name ?? "(unnamed)",
    type: span.type,
    startTimeMs: span.timestamps.started_at,
    endTimeMs: span.timestamps.finished_at,
    durationMs: span.timestamps.finished_at - span.timestamps.started_at,
    status,
    model: "model" in span ? (span.model ?? null) : null,
    vendor: "vendor" in span ? (span.vendor ?? null) : null,
    input: spanDisplay.buildDisplayInput(span),
    output: spanDisplay.stringifySpanIO(span.output),
    error: span.error ? { message: span.error.message, stacktrace: span.error.stacktrace } : null,
    metrics: span.metrics
      ? {
          promptTokens: span.metrics.prompt_tokens,
          completionTokens: span.metrics.completion_tokens,
          cost: span.metrics.cost,
          tokensEstimated: span.metrics.tokens_estimated,
        }
      : null,
    params: span.params ?? null,
    events: rawEvents.map((e) => ({
      name: e.name,
      timestampMs: e.timeUnixMs,
      attributes: e.attributes,
    })),
  };
}

/**
 * The string values of hidden span content, so the legacy span protections can
 * scrub them wherever they ride along (raw message attributes inside params).
 */
export function buildSpanContentRedactions(
  spans: Span[],
  protections: {
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
  },
  spanProtection: TraceSpanProtectionPort,
): Set<string> {
  return new Set<string>([
    ...(protections.canSeeCapturedInput !== true
      ? spanProtection.extractRedactionsFromAllSpanInputs(spans)
      : []),
    ...(protections.canSeeCapturedOutput !== true
      ? spanProtection.extractRedactionsFromAllSpanOutputs(spans)
      : []),
  ]);
}

/**
 * The full per-span redaction pipeline behind bulk span reads: span-level
 * protections (category visibility, restricted custom attributes, hidden
 * content scrubbed out of params), the DTO mapping, the content redaction
 * pass, and the privacy annotations. The single implementation is shared by
 * the internal `tracesV2.spansFull` read and the anonymous share payload
 * (`sharedTrace.get`) — the two surfaces must never drift apart, because a
 * redaction added to one and forgotten in the other silently leaks to share
 * viewers. See ADR-057.
 *
 * Per-span events are deliberately absent (the `[]` below): only the
 * single-span `tracesV2.spanDetail` read fetches them. The trace-level events
 * timeline covers the shared view; per-span events in the share payload are an
 * ADR-057 follow-up.
 */
export function mapSpansToDetailDtos(
  spans: Span[],
  protections: Protections,
  ports: TraceReadMapperPorts,
): SpanDetail[] {
  const redactions = buildSpanContentRedactions(spans, protections, ports.spanProtection);
  return spans.map((span) => {
    const detail = mapSpanToDetail(
      ports.spanProtection.applySpanProtections(span, protections, redactions),
      [],
      ports.spanDisplay,
    );
    const redacted = redactV2Content(detail, protections, ports.contentPrivacy);
    const detailParams = detail.params as Record<string, unknown> | null;
    redacted.contentPrivacy = buildContentPrivacy(
      protections,
      readDroppedFromParams(detailParams, ports.contentPrivacy),
    );
    redacted.piiAnalysisIncomplete = readPiiIncompleteFromParams(
      detailParams,
      ports.contentPrivacy,
    );
    redacted.restrictedAttributes = protections.restrictedAttributes ?? null;
    return redacted;
  });
}

// ---------------------------------------------------------------------------
// Content redaction
// ---------------------------------------------------------------------------

type V2RedactionFlags = {
  inputRedacted: boolean;
  outputRedacted: boolean;
  inputVisibleTo: string | null;
  outputVisibleTo: string | null;
};

/** Protection facts the V2 read mappers consume to enforce restrict at read. */
export type V2Protections = {
  canSeeCosts?: boolean | null;
  canSeeCapturedInput?: boolean | null;
  canSeeCapturedOutput?: boolean | null;
  capturedInputVisibleTo?: string | null;
  capturedOutputVisibleTo?: string | null;
  contentCategories?: Record<ContentCategory, CategoryVisibility>;
  hiddenAttributes?: Array<{ pattern: string; visibleTo: string }>;
};

/**
 * System instructions and tool calls ride INSIDE the captured input/output
 * conversation as system/tool role turns and assistant `tool_calls`. When the
 * viewer is outside their audience the surviving input/output string must have
 * those turns stripped, mirroring the ingestion-time drop, so the transcript
 * never renders content the policy hides. Returns the roles to remove and
 * whether to drop `tool_calls`, derived from per-category visibility.
 */
function turnsHiddenForViewer(protections: V2Protections): {
  roles: Set<string>;
  stripToolCalls: boolean;
} {
  const roles = new Set<string>();
  let stripToolCalls = false;
  const cats = protections.contentCategories;
  if (cats) {
    if (!cats.system.canSee) roles.add("system");
    if (!cats.tools.canSee) {
      roles.add("tool");
      roles.add("function");
      stripToolCalls = true;
    }
  }
  return { roles, stripToolCalls };
}

/**
 * The free-text terms the session search is allowed to match against
 * transcript bodies, for this viewer.
 *
 * These compile into `positionCaseInsensitive` predicates over `log_records`,
 * against BOTH `BodyText` (captured prompts, tool content, raw request
 * bodies) and `AttributesFlatJson` (every attribute on the record, flattened
 * to one JSON blob). Whether a session matches a term IS that content: a
 * viewer who cannot read it must not be able to probe it either, one guess at
 * a time, through which rows come back and what the total says. Redacting the
 * previews afterwards does not help, because the answer already rode out in
 * the row list.
 *
 * So a viewer under ANY content protection searches the trace-level columns
 * only, the same ones the filter translator already applies to them, and the
 * transcript reach is dropped rather than narrowed: the body is one blob, it
 * cannot be matched per category or per attribute key. This covers three
 * independent protection dimensions, and any one of them drops the whole
 * search: whole-category visibility (`canSeeCapturedInput`/`Output`),
 * per-turn-role visibility (`contentCategories`, system/tools), and custom
 * attribute restrict rules (`hiddenAttributes`) — a rule can hide one
 * attribute's value while leaving input/output and every category fully
 * visible, and `AttributesFlatJson` carries that value the same as any other.
 */
export function contentSearchTermsForViewer({
  terms,
  protections,
}: {
  terms: string[];
  protections: V2Protections;
}): string[] {
  if (terms.length === 0) return terms;
  if (protections.canSeeCapturedInput !== true || protections.canSeeCapturedOutput !== true) {
    return [];
  }
  const { roles, stripToolCalls } = turnsHiddenForViewer(protections);
  if (roles.size > 0 || stripToolCalls) return [];
  if ((protections.hiddenAttributes?.length ?? 0) > 0) return [];
  return terms;
}

/**
 * Synthetic hidden-attribute rules for the standalone system/tools attribute
 * keys (`gen_ai.system_instructions`, `gen_ai.tool.call.*`, …) when those
 * categories are hidden from the viewer, so their values are replaced by the
 * audience-naming placeholder in the attributes table just like a custom
 * restrict rule — the conversation turns are handled separately.
 */
function hiddenCategoryAttributeRules(
  protections: V2Protections,
  contentPrivacy: TraceContentPrivacyPort,
): Array<{ pattern: string; visibleTo: string }> {
  const cats = protections.contentCategories;
  if (!cats) return [];
  const rules: Array<{ pattern: string; visibleTo: string }> = [];
  for (const category of ["system", "tools"] as const) {
    if (!cats[category].canSee) {
      for (const key of contentPrivacy.contentKeyCatalog[category]) {
        rules.push({
          pattern: key,
          visibleTo: cats[category].restrictVisibleTo ?? "no one",
        });
      }
    }
  }
  return rules;
}

/**
 * Recursively remove hidden chat turns from any attribute value: drop messages
 * whose role is hidden, strip assistant `tool_calls` when tool calls are hidden,
 * and apply the same to JSON-string-encoded conversations. This covers the raw
 * chat-array attributes (`gen_ai.input.messages`, `langwatch.input`, …) the
 * attributes table can expand — they are input/output-category keys, so the
 * placeholder rules above do not touch them, yet they still carry the system and
 * tool turns. Returns a new value; the input is not mutated.
 */
function stripHiddenChatTurnsDeep(
  node: unknown,
  roles: ReadonlySet<string>,
  stripToolCalls: boolean,
  contentPrivacy: TraceContentPrivacyPort,
): unknown {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      const role = item && typeof item === "object" ? (item as { role?: unknown }).role : undefined;
      if (typeof role === "string" && roles.has(role)) continue;
      out.push(stripHiddenChatTurnsDeep(item, roles, stripToolCalls, contentPrivacy));
    }
    return out;
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (stripToolCalls && key === "tool_calls") continue;
      out[key] = stripHiddenChatTurnsDeep(value, roles, stripToolCalls, contentPrivacy);
    }
    return out;
  }
  if (typeof node === "string") {
    const result = contentPrivacy.stripRolesFromChatArrayJson(node, roles, stripToolCalls);
    return result ? result.json : node;
  }
  return node;
}

export function redactV2Content<
  T extends {
    input?: string | null;
    output?: string | null;
    inputRedacted?: boolean | null;
    outputRedacted?: boolean | null;
    inputVisibleTo?: string | null;
    outputVisibleTo?: string | null;
    inputMediaRefs?: unknown;
    outputMediaRefs?: unknown;
    attributes?: Record<string, string>;
    params?: Record<string, unknown> | null;
  },
>(
  dto: T,
  protections: V2Protections,
  contentPrivacy: TraceContentPrivacyPort,
): T & V2RedactionFlags {
  // A field is redacted only when there WAS content the viewer may not see, so a
  // genuinely empty input never renders the placeholder. The audience label
  // rides along so the drawer can say who it is visible to.
  const inputRedacted = protections.canSeeCapturedInput !== true && dto.input != null;
  const outputRedacted = protections.canSeeCapturedOutput !== true && dto.output != null;

  // Strip hidden system/tool turns from any surviving (visible) conversation.
  const { roles, stripToolCalls } = turnsHiddenForViewer(protections);
  const stripTurns = (json: string | null): string | null => {
    if (json == null || (roles.size === 0 && !stripToolCalls)) return json;
    const result = contentPrivacy.stripRolesFromChatArrayJson(json, roles, stripToolCalls);
    return result ? result.json : json;
  };
  const visibleInput = protections.canSeeCapturedInput === true ? (dto.input ?? null) : null;
  const visibleOutput = protections.canSeeCapturedOutput === true ? (dto.output ?? null) : null;

  const redacted: T & V2RedactionFlags = {
    ...dto,
    input: stripTurns(visibleInput),
    output: stripTurns(visibleOutput),
    inputRedacted,
    outputRedacted,
    inputVisibleTo: inputRedacted ? (protections.capturedInputVisibleTo ?? null) : null,
    outputVisibleTo: outputRedacted ? (protections.capturedOutputVisibleTo ?? null) : null,
  };
  // Media refs point at the exact content that was just redacted, and the
  // /api/files URLs they carry are fetchable on their own — so the parsed ref
  // fields AND their reserved-attribute copies must be dropped alongside the
  // text, never just hidden by the UI.
  if (inputRedacted) delete redacted.inputMediaRefs;
  if (outputRedacted) delete redacted.outputMediaRefs;
  if ((inputRedacted || outputRedacted) && redacted.attributes) {
    const attributes = { ...redacted.attributes };
    if (inputRedacted) delete attributes[RESERVED_INPUT_MEDIA_REFS];
    if (outputRedacted) delete attributes[RESERVED_OUTPUT_MEDIA_REFS];
    redacted.attributes = attributes;
  }
  // Custom attribute rules with a restrict disposition, plus the standalone
  // system/tools attribute keys when those categories are hidden: replace the
  // matched attribute values (header attributes, span params, span-event
  // attributes) with the placeholder naming who can see them.
  const hidden = [
    ...(protections.hiddenAttributes ?? []),
    ...hiddenCategoryAttributeRules(protections, contentPrivacy),
  ];
  if (hidden.length > 0) {
    const redactor = TraceAttributeRedactor.for(hidden);
    if (dto.attributes) {
      redacted.attributes = redactor.redact(dto.attributes);
    }
    if (dto.params) {
      redacted.params = redactor.redact(dto.params);
    }
    // Span-detail events carry their own attribute records (list-item events
    // do not, hence the localized cast instead of a constraint field).
    const events = (dto as { events?: Array<{ attributes?: Record<string, unknown> }> }).events;
    if (events?.some((event) => event.attributes)) {
      (redacted as Record<string, unknown>).events = events.map((event) =>
        event.attributes
          ? {
              ...event,
              attributes: redactor.redact(event.attributes),
            }
          : event,
      );
    }
  }
  // The raw chat-array attributes still carry the hidden system/tool turns
  // (they are input/output-category keys, untouched by the rules above), so an
  // expanded attribute could reveal them. Strip those turns from params and
  // attributes too, when any are hidden.
  if (roles.size > 0 || stripToolCalls) {
    if (redacted.params) {
      redacted.params = stripHiddenChatTurnsDeep(
        redacted.params,
        roles,
        stripToolCalls,
        contentPrivacy,
      ) as T["params"];
    }
    if (redacted.attributes) {
      redacted.attributes = stripHiddenChatTurnsDeep(
        redacted.attributes,
        roles,
        stripToolCalls,
        contentPrivacy,
      ) as T["attributes"];
    }
  }
  return redacted;
}

/**
 * One turn of a session, as `conversationContext` lists it. Carries the
 * permission-nulled input/output AND the redaction flags so a hidden turn
 * renders the "Redacted" marker in the conversation strip / view instead of an
 * empty "(no message)" placeholder that would read as a genuinely-absent turn.
 * Carries the turn's totals so the terminal's bottom bar can count the
 * session's turns above its loaded window without reading their transcripts.
 */
export function toConversationContextTurn({
  trace: t,
  protections,
  contentPrivacy,
}: {
  trace: TraceListItem;
  protections: V2Protections;
  contentPrivacy: TraceContentPrivacyPort;
}) {
  const { input, output, inputRedacted, outputRedacted, inputVisibleTo, outputVisibleTo } =
    redactV2Content(
      {
        traceId: t.traceId,
        timestamp: t.timestamp,
        name: t.traceName || t.name,
        rootSpanType: t.rootSpanType ?? null,
        status: t.status,
        input: t.input ?? null,
        output: t.output ?? null,
      },
      protections,
      contentPrivacy,
    );
  return {
    traceId: t.traceId,
    timestamp: t.timestamp,
    name: t.traceName || t.name,
    rootSpanType: t.rootSpanType ?? null,
    status: t.status,
    input,
    output,
    inputRedacted,
    outputRedacted,
    inputVisibleTo,
    outputVisibleTo,
    totalTokens: t.totalTokens,
    // Spend follows the viewer's own `cost:view` (ADR-057), the same rule the
    // session rows and the trace header apply through `gateSessionCost` /
    // `gateHeaderCost`. Without it a viewer who may not read the session
    // rollup could add the same total up one turn at a time.
    totalCost: protections.canSeeCosts === true ? t.totalCost : null,
  };
}

/**
 * Read a dotted-key string attribute from mapped span params. The span mapper
 * unflattens dotted attribute keys into nested objects, so a marker lands at the
 * matching nested path rather than as a flat key.
 */
function readNestedString(
  params: Record<string, unknown> | null | undefined,
  dottedKey: string,
): string | null {
  let node: unknown = params;
  for (const key of dottedKey.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : null;
}

/**
 * The per-span drop marker (`langwatch.privacy.dropped`) as a category set.
 * Reading the marker (not the live policy) means traces from before a drop rule
 * was added are never mislabeled.
 */
export function readDroppedFromParams(
  params: Record<string, unknown> | null | undefined,
  contentPrivacy: TraceContentPrivacyPort,
): Set<string> {
  const value = readNestedString(params, contentPrivacy.droppedMarkerAttribute);
  if (value == null) return new Set();
  return new Set(
    value
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean),
  );
}

/** Whether a span carries the incomplete-strict-PII marker. */
export function readPiiIncompleteFromParams(
  params: Record<string, unknown> | null | undefined,
  contentPrivacy: TraceContentPrivacyPort,
): boolean {
  return readNestedString(params, contentPrivacy.piiIncompleteMarkerAttribute) != null;
}

/**
 * The generic per-category privacy status for the drawer, combining the
 * read-time restrict decision (from the resolved policy, retroactive) with the
 * per-span drop marker (which follows the data). Drop wins when both apply: the
 * content is genuinely gone, so there is nothing left to restrict.
 */
export function buildContentPrivacy(
  protections: {
    contentCategories?: Record<ContentCategory, CategoryVisibility>;
  },
  droppedCategories: ReadonlySet<string>,
): ContentPrivacy {
  const cats = protections.contentCategories;
  return Object.fromEntries(
    CONTENT_CATEGORIES.map((category) => {
      if (droppedCategories.has(category)) {
        return [category, { state: "dropped", visibleTo: null }];
      }
      const c = cats?.[category];
      if (c && !c.canSee) {
        return [category, { state: "restricted", visibleTo: c.restrictVisibleTo }];
      }
      // Visible: a non-null label means restricted but THIS viewer is in the
      // audience (the "visible to you" badge); null means ordinary capture.
      return [category, { state: "visible", visibleTo: c?.restrictVisibleTo ?? null }];
    }),
  ) as ContentPrivacy;
}

// ---------------------------------------------------------------------------
// Trace-correlated log records
// ---------------------------------------------------------------------------

/** The log-record attribute carrying the emitter's event name. */
const LOG_EVENT_NAME_ATTR = "event.name";

/**
 * The two ingest-derived content attribute prefixes. A derived attribute is
 * the same captured content re-shaped at ingest, so each is stripped behind
 * the category it was computed from.
 */
export type TraceDerivedAttrPrefixes = Readonly<{
  input: string;
  output: string;
}>;

/**
 * Enforce captured-content visibility on one trace-correlated log record before
 * it leaves the API. The raw log records carry their content under PER-EVENT
 * attribute keys — `prompt` for a user prompt, `response` / `response_text` for
 * a reply, `arguments` / `tool_input` and `output` for a tool run — plus the
 * top-level OTLP body for content-of-record emitters. Every one of those keys
 * is withheld behind the SAME `canSeeCapturedInput` / `canSeeCapturedOutput`
 * visibility the sibling span endpoints enforce, from `logContentKeys`, the one
 * table the read-path enrichment surfaces content from — a key surfaced by one
 * and missed by the other is a policy bypass.
 *
 * Gating is per KEY, not per record: a codex `tool_result` carries the call's
 * `arguments` (input) and its `output` (output) together, so one verdict for
 * the whole record could only ever be right in one direction.
 *
 * Ingest also stamps DERIVED content onto the attributes
 * (`langwatch.gen_ai.output.text`, `…output.tool_calls`, …input counts): the
 * same captured content re-shaped, so each is stripped behind the category it
 * was computed from.
 *
 * A key whose category the table does not know fails closed and needs BOTH
 * visibilities. Only content is withheld: event name, `request_id`,
 * `cost_usd`, `query_source` and every other metadata attribute (and cost,
 * governed by its own permission) pass through untouched, so a structural
 * record like the `api_request` cost anchor is returned intact.
 */
export function redactTraceLogContent(
  row: TraceLogRecordDto,
  protections: {
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
    capturedInputVisibleTo?: string | null;
    capturedOutputVisibleTo?: string | null;
  },
  codingAgents: CodingAgentService,
  derivedAttrPrefixes: TraceDerivedAttrPrefixes,
): TraceLogRecordDto {
  const eventName = row.attributes[LOG_EVENT_NAME_ATTR] ?? "";
  const canSeeInput = protections.canSeeCapturedInput === true;
  const canSeeOutput = protections.canSeeCapturedOutput === true;
  const canSee = (category: LogContentCategory): boolean =>
    category === "input"
      ? canSeeInput
      : category === "output"
        ? canSeeOutput
        : canSeeInput && canSeeOutput;

  const contentKeys = codingAgents.logContentKeys(eventName);
  const hiddenKeys = contentKeys.filter((entry) => {
    const value = row.attributes[entry.key];
    return typeof value === "string" && value.length > 0 && !canSee(entry.category);
  });
  const hiddenDerivedKeys = Object.keys(row.attributes).filter((key) => {
    if (key.startsWith(derivedAttrPrefixes.input)) return !canSeeInput;
    if (key.startsWith(derivedAttrPrefixes.output)) return !canSeeOutput;
    return false;
  });
  // The top-level OTLP body is content only when it is NOT merely echoing the
  // event-name marker (claude_code stamps the marker there; a generic
  // content-of-record emitter puts the record's content there). It follows the
  // event's own `body` category, or fails closed when the event is unknown.
  const bodyCategory: LogContentCategory =
    contentKeys.find((entry) => entry.key === "body")?.category ?? "both";
  const shouldHideBody = row.body.length > 0 && row.body !== eventName && !canSee(bodyCategory);

  if (hiddenKeys.length === 0 && hiddenDerivedKeys.length === 0 && !shouldHideBody) {
    return row;
  }

  const attributes = { ...row.attributes };
  for (const entry of hiddenKeys) delete attributes[entry.key];
  for (const key of hiddenDerivedKeys) delete attributes[key];

  // The audience label only means something when ONE category was withheld:
  // a record that shed both sides has no single audience to name.
  const hiddenCategories = new Set<LogContentCategory>([
    ...hiddenKeys.map((entry) => entry.category),
    ...(shouldHideBody ? [bodyCategory] : []),
    ...(hiddenDerivedKeys.some((key) => key.startsWith(derivedAttrPrefixes.input))
      ? (["input"] as const)
      : []),
    ...(hiddenDerivedKeys.some((key) => key.startsWith(derivedAttrPrefixes.output))
      ? (["output"] as const)
      : []),
  ]);
  const onlyHidden = hiddenCategories.size === 1 ? [...hiddenCategories][0] : null;

  return {
    ...row,
    body: shouldHideBody ? "" : row.body,
    attributes,
    bodyRedacted: true,
    bodyVisibleTo:
      onlyHidden === "input"
        ? (protections.capturedInputVisibleTo ?? null)
        : onlyHidden === "output"
          ? (protections.capturedOutputVisibleTo ?? null)
          : null,
  };
}

/**
 * Apply BOTH gates to one trace-correlated log record: the free-plan teaser
 * window and the viewer's captured-content permission.
 *
 * A record older than the plan `visibilityCutoffMs` has its captured content
 * withheld regardless of the viewer's permission — a plan gate, not an audience
 * gate, so it offers no "visible to …" label (there is no group that can see
 * it, only a plan upgrade). This mirrors the sibling span reads, which
 * teaser-redact pre-cutoff spans via `applyVisibilityGate`. Post-cutoff records
 * (and every record when `visibilityCutoffMs` is null — a paid plan with no
 * window) fall through to the viewer's real captured-input / captured-output
 * visibility. Fails closed: a pre-cutoff record is gated as if no captured
 * content were visible.
 */
export function gateTraceLogVisibility(
  row: TraceLogRecordDto,
  protections: {
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
    capturedInputVisibleTo?: string | null;
    capturedOutputVisibleTo?: string | null;
  },
  visibilityCutoffMs: number | null,
  codingAgents: CodingAgentService,
  derivedAttrPrefixes: TraceDerivedAttrPrefixes,
): TraceLogRecordDto {
  const isBeforeCutoff = visibilityCutoffMs !== null && row.timeUnixMs < visibilityCutoffMs;
  return redactTraceLogContent(
    row,
    isBeforeCutoff ? { canSeeCapturedInput: false, canSeeCapturedOutput: false } : protections,
    codingAgents,
    derivedAttrPrefixes,
  );
}
