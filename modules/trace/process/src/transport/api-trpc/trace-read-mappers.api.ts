import type { CodingAgentApi, LogContentCategory } from "@langwatch/coding-agent-contract";
/**
 * Shared mapping/redaction layer for both trace-view transports (authenticated
 * and anonymous). Single implementation ensures a redaction cannot drift between
 * surfaces. Three capabilities injected to avoid cross-feature dependencies.
 */
import { CONTENT_CATEGORIES, type ContentCategory } from "@langwatch/data-privacy-contract";
import type {
  CategoryVisibility,
  Protections,
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

import { TraceAttributeRedactionService } from "../../services/trace-attribute-redaction.service.ts";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** How a span's captured input/output becomes the text the drawer renders. */
export type TraceSpanDisplay = Readonly<{
  buildDisplayInput(span: Pick<Span, "input" | "params">): string | null;
  stringifySpanIO(io: SpanInputOutput | null | undefined): string | null;
}>;

/**
 * The legacy span-protection pass: the one that redacts a span's own
 * input/output, strips its metrics behind `cost:view`, and scrubs hidden
 * content wherever it rides along inside `params` and events.
 */
export type TraceSpanProtection = Readonly<{
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
export type TraceContentPrivacy = Readonly<{
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
export type TraceReadMapperMembers = Readonly<{
  spanDisplay: TraceSpanDisplay;
  spanProtection: TraceSpanProtection;
  contentPrivacy: TraceContentPrivacy;
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
 * Trace-level DROP banner: checks original content to detect categories dropped
 * at ingestion. Resolution failures yield no banner (non-breaking). Shared by
 * both transports (ADR-057).
 */
export async function deriveTraceDropPrivacy(
  rawHeader: Pick<TraceHeader, "input" | "output">,
  projectId: string,
  contentPrivacy: TraceContentPrivacy,
): Promise<TraceHeader["privacy"]> {
  try {
    const policy = await contentPrivacy.getResolvedPolicyForProject({ projectId });
    const droppedCategories: string[] = [];
    const dropsInput = policy.categories.input.disposition === "drop";
    const dropsOutput = policy.categories.output.disposition === "drop";
    if (dropsInput && !rawHeader.input) {
      droppedCategories.push("input");
    }
    if (dropsOutput && !rawHeader.output) {
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
  rawEvents: {
    name: string;
    timeUnixMs: number;
    attributes: Record<string, unknown>;
  }[],
  spanDisplay: TraceSpanDisplay,
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
  spanProtection: TraceSpanProtection,
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
 * Full per-span redaction pipeline: protections, DTO mapping, content redaction,
 * privacy annotations. Single shared implementation prevents drift. Per-span
 * events deliberately absent (ADR-057 follow-up).
 */
export function mapSpansToDetailDtos(
  spans: Span[],
  protections: Protections,
  ports: TraceReadMapperMembers,
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
  hiddenAttributes?: { pattern: string; visibleTo: string }[];
};

/**
 * Strip system/tool turns from surviving input/output to match policy
 * visibility. Returns roles to remove and whether to drop tool_calls.
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
 * Search terms for transcript bodies, gated per viewer: any content protection
 * drops transcript search entirely (body cannot be narrowed per category).
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
 * Synthetic hidden-attribute rules for system/tools attribute keys when
 * categories are hidden, replacing values with audience-naming placeholders.
 */
function hiddenCategoryAttributeRules(
  protections: V2Protections,
  contentPrivacy: TraceContentPrivacy,
): { pattern: string; visibleTo: string }[] {
  const cats = protections.contentCategories;
  if (!cats) return [];
  const rules: { pattern: string; visibleTo: string }[] = [];
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
 * Recursively strip hidden chat turns from attribute values: drop messages by
 * role, strip tool_calls, apply to JSON-encoded conversations. Input not mutated.
 */
function stripHiddenChatTurnsFromArray({
  node,
  roles,
  stripToolCalls,
  contentPrivacy,
}: {
  node: unknown[];
  roles: ReadonlySet<string>;
  stripToolCalls: boolean;
  contentPrivacy: TraceContentPrivacy;
}): unknown[] {
  const out: unknown[] = [];
  for (const item of node) {
    const role = item && typeof item === "object" ? (item as { role?: unknown }).role : undefined;
    if (typeof role === "string" && roles.has(role)) continue;
    out.push(stripHiddenChatTurnsDeep({ node: item, roles, stripToolCalls, contentPrivacy }));
  }

  return out;
}

function stripHiddenChatTurnsFromObject({
  node,
  roles,
  stripToolCalls,
  contentPrivacy,
}: {
  node: object;
  roles: ReadonlySet<string>;
  stripToolCalls: boolean;
  contentPrivacy: TraceContentPrivacy;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (stripToolCalls && key === "tool_calls") continue;
    out[key] = stripHiddenChatTurnsDeep({ node: value, roles, stripToolCalls, contentPrivacy });
  }

  return out;
}

function stripHiddenChatTurnsDeep({
  node,
  roles,
  stripToolCalls,
  contentPrivacy,
}: {
  node: unknown;
  roles: ReadonlySet<string>;
  stripToolCalls: boolean;
  contentPrivacy: TraceContentPrivacy;
}): unknown {
  if (Array.isArray(node)) {
    return stripHiddenChatTurnsFromArray({ node, roles, stripToolCalls, contentPrivacy });
  }
  if (node && typeof node === "object") {
    return stripHiddenChatTurnsFromObject({ node, roles, stripToolCalls, contentPrivacy });
  }
  if (typeof node === "string") {
    const result = contentPrivacy.stripRolesFromChatArrayJson(node, roles, stripToolCalls);
    return result ? result.json : node;
  }

  return node;
}

/** The shape `redactV2Content` narrows to; every field is optional on the DTOs it serves. */
type RedactableV2Dto = {
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
};

/**
 * Media refs point at the exact content that was just redacted, and the /api/files URLs they
 * carry are fetchable on their own — so the parsed ref fields AND their reserved-attribute
 * copies must be dropped alongside the text, never just hidden by the UI.
 */
function dropRedactedMediaRefs<T extends RedactableV2Dto>(
  redacted: T & V2RedactionFlags,
  flags: Readonly<{ inputRedacted: boolean; outputRedacted: boolean }>,
): void {
  const { inputRedacted, outputRedacted } = flags;
  if (inputRedacted) delete redacted.inputMediaRefs;
  if (outputRedacted) delete redacted.outputMediaRefs;
  if (!inputRedacted && !outputRedacted) return;
  if (!redacted.attributes) return;

  const attributes = { ...redacted.attributes };
  if (inputRedacted) delete attributes[RESERVED_INPUT_MEDIA_REFS];
  if (outputRedacted) delete attributes[RESERVED_OUTPUT_MEDIA_REFS];
  redacted.attributes = attributes;
}

/**
 * Custom attribute rules with a restrict disposition, plus the standalone system/tools attribute
 * keys when those categories are hidden: replace the matched attribute values (header
 * attributes, span params, span-event attributes) with the placeholder naming who can see them.
 */
function redactHiddenAttributes<T extends RedactableV2Dto>({
  redacted,
  dto,
  protections,
  contentPrivacy,
}: {
  redacted: T & V2RedactionFlags;
  dto: T;
  protections: V2Protections;
  contentPrivacy: TraceContentPrivacy;
}): void {
  const hidden = [
    ...(protections.hiddenAttributes ?? []),
    ...hiddenCategoryAttributeRules(protections, contentPrivacy),
  ];
  if (hidden.length === 0) return;

  const redactor = TraceAttributeRedactionService.create(hidden);
  if (dto.attributes) {
    redacted.attributes = redactor.redact(dto.attributes);
  }
  if (dto.params) {
    redacted.params = redactor.redact(dto.params);
  }

  // Span-detail events carry their own attribute records (list-item events
  // do not, hence the localized cast instead of a constraint field).
  const events = (dto as { events?: { attributes?: Record<string, unknown> }[] }).events;
  if (!events?.some((event) => event.attributes)) return;

  (redacted as Record<string, unknown>).events = events.map((event) =>
    event.attributes ? { ...event, attributes: redactor.redact(event.attributes) } : event,
  );
}

/**
 * The raw chat-array attributes still carry the hidden system/tool turns (they are
 * input/output-category keys, untouched by the attribute rules), so an expanded attribute could
 * reveal them. Strips those turns from params and attributes too.
 */
function stripHiddenTurnsFromCarriers<T extends RedactableV2Dto>({
  redacted,
  roles,
  stripToolCalls,
  contentPrivacy,
}: {
  redacted: T & V2RedactionFlags;
  roles: ReadonlySet<string>;
  stripToolCalls: boolean;
  contentPrivacy: TraceContentPrivacy;
}): void {
  if (roles.size === 0 && !stripToolCalls) return;

  if (redacted.params) {
    redacted.params = stripHiddenChatTurnsDeep({
      node: redacted.params,
      roles,
      stripToolCalls,
      contentPrivacy,
    }) as T["params"];
  }
  if (redacted.attributes) {
    redacted.attributes = stripHiddenChatTurnsDeep({
      node: redacted.attributes,
      roles,
      stripToolCalls,
      contentPrivacy,
    }) as T["attributes"];
  }
}

export function redactV2Content<T extends RedactableV2Dto>(
  dto: T,
  protections: V2Protections,
  contentPrivacy: TraceContentPrivacy,
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

  dropRedactedMediaRefs(redacted, { inputRedacted, outputRedacted });
  redactHiddenAttributes({ redacted, dto, protections, contentPrivacy });
  stripHiddenTurnsFromCarriers({ redacted, roles, stripToolCalls, contentPrivacy });

  return redacted;
}

/**
 * Session turn with redaction flags: hidden turns render "Redacted" marker, not
 * empty placeholders. Includes totals for counting above loaded window.
 */
export function toConversationContextTurn({
  trace: t,
  protections,
  contentPrivacy,
}: {
  trace: TraceListItem;
  protections: V2Protections;
  contentPrivacy: TraceContentPrivacy;
}): {
  traceId: string;
  timestamp: number;
  name: string;
  rootSpanType: string | null;
  status: "error" | "ok" | "warning";
  input: string | null;
  output: string | null;
  inputRedacted: boolean;
  outputRedacted: boolean;
  inputVisibleTo: string | null;
  outputVisibleTo: string | null;
  totalTokens: number;
  totalCost: number | null;
} {
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
function findNestedString(
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
  contentPrivacy: TraceContentPrivacy,
): Set<string> {
  const value = findNestedString(params, contentPrivacy.droppedMarkerAttribute);
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
  contentPrivacy: TraceContentPrivacy,
): boolean {
  return findNestedString(params, contentPrivacy.piiIncompleteMarkerAttribute) != null;
}

/**
 * Per-category privacy status combining read-time restrict and per-span drop
 * markers. Drop wins when both apply.
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

type LogVisibility = Readonly<{
  canSeeCapturedInput?: boolean | null;
  canSeeCapturedOutput?: boolean | null;
  capturedInputVisibleTo?: string | null;
  capturedOutputVisibleTo?: string | null;
}>;

/** Whether one content category is visible. An unknown category fails closed and needs both. */
function canSeeCategory(category: LogContentCategory, protections: LogVisibility): boolean {
  const canSeeInput = protections.canSeeCapturedInput === true;
  const canSeeOutput = protections.canSeeCapturedOutput === true;
  if (category === "input") return canSeeInput;
  if (category === "output") return canSeeOutput;

  return canSeeInput && canSeeOutput;
}

/** Ingest-stamped derived content, stripped behind the category it was computed from. */
function findHiddenDerivedKeys(
  attributes: Record<string, string>,
  protections: LogVisibility,
  derivedAttrPrefixes: TraceDerivedAttrPrefixes,
): string[] {
  return Object.keys(attributes).filter((key) => {
    if (key.startsWith(derivedAttrPrefixes.input)) return protections.canSeeCapturedInput !== true;
    if (key.startsWith(derivedAttrPrefixes.output)) {
      return protections.canSeeCapturedOutput !== true;
    }

    return false;
  });
}

/**
 * The audience label only means something when ONE category was withheld: a record that shed
 * both sides has no single audience to name.
 */
function onlyHiddenCategory(
  input: Readonly<{
    hiddenKeys: readonly { category: LogContentCategory }[];
    hiddenDerivedKeys: readonly string[];
    shouldHideBody: boolean;
    bodyCategory: LogContentCategory;
    derivedAttrPrefixes: TraceDerivedAttrPrefixes;
  }>,
): LogContentCategory | null {
  const { hiddenDerivedKeys, derivedAttrPrefixes } = input;
  const hidesDerivedInput = hiddenDerivedKeys.some((key) =>
    key.startsWith(derivedAttrPrefixes.input),
  );
  const hidesDerivedOutput = hiddenDerivedKeys.some((key) =>
    key.startsWith(derivedAttrPrefixes.output),
  );
  const hiddenCategories = new Set<LogContentCategory>([
    ...input.hiddenKeys.map((entry) => entry.category),
    ...(input.shouldHideBody ? [input.bodyCategory] : []),
    ...(hidesDerivedInput ? (["input"] as const) : []),
    ...(hidesDerivedOutput ? (["output"] as const) : []),
  ]);

  return hiddenCategories.size === 1 ? ([...hiddenCategories][0] ?? null) : null;
}

function visibleToLabel(
  onlyHidden: LogContentCategory | null,
  protections: LogVisibility,
): string | null {
  if (onlyHidden === "input") return protections.capturedInputVisibleTo ?? null;
  if (onlyHidden === "output") return protections.capturedOutputVisibleTo ?? null;

  return null;
}

/**
 * Enforce captured-content visibility per event key (not per record): gating
 * matches span endpoints. Metadata (event name, cost) passes through untouched.
 */
export function redactTraceLogContent({
  row,
  protections,
  codingAgents,
  derivedAttrPrefixes,
}: {
  row: TraceLogRecordDto;
  protections: LogVisibility;
  codingAgents: Pick<CodingAgentApi, "logContentKeys">;
  derivedAttrPrefixes: TraceDerivedAttrPrefixes;
}): TraceLogRecordDto {
  const eventName = row.attributes[LOG_EVENT_NAME_ATTR] ?? "";

  const contentKeys = codingAgents.logContentKeys(eventName);
  const hiddenKeys = contentKeys.filter((entry) => {
    const value = row.attributes[entry.key];
    return (
      typeof value === "string" && value.length > 0 && !canSeeCategory(entry.category, protections)
    );
  });
  const hiddenDerivedKeys = findHiddenDerivedKeys(row.attributes, protections, derivedAttrPrefixes);
  // The top-level OTLP body is content only when it is NOT merely echoing the
  // event-name marker (claude_code stamps the marker there; a generic
  // content-of-record emitter puts the record's content there). It follows the
  // event's own `body` category, or fails closed when the event is unknown.
  const bodyCategory: LogContentCategory =
    contentKeys.find((entry) => entry.key === "body")?.category ?? "both";
  const shouldHideBody =
    row.body.length > 0 && row.body !== eventName && !canSeeCategory(bodyCategory, protections);

  if (hiddenKeys.length === 0 && hiddenDerivedKeys.length === 0 && !shouldHideBody) {
    return row;
  }

  const attributes = { ...row.attributes };
  for (const entry of hiddenKeys) delete attributes[entry.key];
  for (const key of hiddenDerivedKeys) delete attributes[key];

  const onlyHidden = onlyHiddenCategory({
    hiddenKeys,
    hiddenDerivedKeys,
    shouldHideBody,
    bodyCategory,
    derivedAttrPrefixes,
  });

  return {
    ...row,
    body: shouldHideBody ? "" : row.body,
    attributes,
    bodyRedacted: true,
    bodyVisibleTo: visibleToLabel(onlyHidden, protections),
  };
}

/**
 * Apply both visibility gates: plan teaser window and viewer permission. Pre-cutoff
 * records are gated as if no captured content were visible.
 */
export function gateTraceLogVisibility({
  row,
  protections,
  visibilityCutoffMs,
  codingAgents,
  derivedAttrPrefixes,
}: {
  row: TraceLogRecordDto;
  protections: {
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
    capturedInputVisibleTo?: string | null;
    capturedOutputVisibleTo?: string | null;
  };
  visibilityCutoffMs: number | null;
  codingAgents: Pick<CodingAgentApi, "logContentKeys">;
  derivedAttrPrefixes: TraceDerivedAttrPrefixes;
}): TraceLogRecordDto {
  const isBeforeCutoff = visibilityCutoffMs !== null && row.timeUnixMs < visibilityCutoffMs;
  return redactTraceLogContent({
    row,
    protections: isBeforeCutoff
      ? { canSeeCapturedInput: false, canSeeCapturedOutput: false }
      : protections,
    codingAgents,
    derivedAttrPrefixes,
  });
}
