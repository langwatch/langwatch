import type { SpanDetail as FullSpan, SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import type { DerivedTraceEvent } from "@langwatch/trace-contract";
import { formatCost, formatDuration } from "../../../../../model/display-formatters.ts";
import { type MarkdownConfig } from "../../../../../model/markdown/types.ts";
import { readableDate } from "../../../../../model/display-formatters.ts";

const AI_SPAN_TYPES = new Set(["llm", "agent", "rag", "tool", "evaluation"]);

/** Marks span `s` and every ancestor of it as kept, in `keep`, by span id. */
function keepAiSpanAndAncestors(
  s: SpanTreeNode,
  byId: Map<string, SpanTreeNode>,
  keep: Set<string>,
): void {
  const isAiSpan = AI_SPAN_TYPES.has((s.type ?? "span").toLowerCase());
  if (!isAiSpan) {
    return;
  }
  keep.add(s.spanId);
  let parentId = s.parentSpanId;
  while (parentId && !keep.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    keep.add(parent.spanId);
    parentId = parent.parentSpanId;
  }
}

// Attribute keys we always drop from the LLM-optimised output. These add
// tokens without telling the LLM anything useful for reasoning about the
// trace.
const NOISY_ATTR_KEYS = new Set<string>([
  "service.name",
  "telemetry.sdk.language",
  "telemetry.sdk.name",
  "telemetry.sdk.version",
  "process.pid",
  "process.runtime.name",
  "process.runtime.version",
  "process.runtime.description",
  "deployment.environment",
  "host.name",
  "host.arch",
  "os.type",
  "os.description",
  "os.version",
  "container.id",
  "langwatch.reserved.output_source",
]);
const NOISY_ATTR_PREFIXES = ["telemetry.sdk.", "process.", "host.", "os."];

const MAX_VALUE_LEN = 320;

function truncate(value: string, max = MAX_VALUE_LEN): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function isNoisyKey(key: string): boolean {
  if (NOISY_ATTR_KEYS.has(key)) return true;
  return NOISY_ATTR_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Flatten a nested object to dot-path key:value lines, YAML-flavoured.
 */
function flattenAttributes(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    out.push(...attributeLines(prefix ? `${prefix}.${k}` : k, v));
  }
  return out;
}

/** One attribute as lines: nothing for noise and blanks, nested for objects. */
function attributeLines(path: string, v: unknown): string[] {
  if (isNoisyKey(path)) return [];
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return arrayAttributeLines(path, v);
  if (typeof v === "object") return flattenAttributes(v as Record<string, unknown>, path);
  return [`${path}: ${truncate(String(v))}`];
}

/** An array attribute inline, or one item per line once it stops being readable. */
function arrayAttributeLines(path: string, values: unknown[]): string[] {
  const inline = values.map((x) =>
    typeof x === "object" && x != null ? JSON.stringify(x) : String(x),
  );
  const joined = inline.join(", ");
  if (joined.length <= 120) return [`${path}: [${truncate(joined, 120)}]`];
  return [`${path}:`, ...inline.map((item) => `  - ${truncate(item)}`)];
}

interface CompactMessage {
  role: string;
  /** Flattened single-line preview, used when no rich blocks are present. */
  content: string;
  /** Original `content` field (string or block array). */
  rawContent: unknown;
  tool?: string;
}

/**
 * Detect chat-message-shaped JSON (`[{role, content}, …]`) and flatten it
 * into a YAML-flavoured role/content list. Falls back to a truncated raw
 * string for everything else (text, tool results, opaque payloads).
 */
function compactIO(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.split("\n").map((l) => truncate(l, 400));
  }

  const messages = extractChatMessages(parsed);
  if (messages.length === 0) return nonChatLines(parsed);
  return messages.flatMap(compactMessageLines);
}

/**
 * Some other JSON payload — flat key: value lines when it is an object, else
 * stringified compactly.
 */
function nonChatLines(parsed: unknown): string[] {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return flattenAttributes(parsed as Record<string, unknown>);
  }
  return [truncate(JSON.stringify(parsed), 600)];
}

const RICH_BLOCK_TYPES = [
  "thinking",
  "reasoning",
  "redacted_thinking",
  "tool_use",
  "tool_call",
  "tool_result",
];

function isRichBlock(b: unknown): boolean {
  return (
    !!b &&
    typeof b === "object" &&
    RICH_BLOCK_TYPES.includes((b as Record<string, unknown>).type as string)
  );
}

/**
 * Whether the message carries structured blocks (thinking, tool_use,
 * tool_result, mixed text), or raw string content holding inline thinking tags:
 * both get expanded as nested YAML so each block is independently inspectable.
 */
function hasRichBlocks(m: CompactMessage): boolean {
  const rich =
    (Array.isArray(m.rawContent) && m.rawContent.some(isRichBlock)) ||
    (typeof m.rawContent === "string" && THINKING_TAG_RE.test(m.rawContent));
  // Reset regex lastIndex — `THINKING_TAG_RE` is global so test() advances it.
  THINKING_TAG_RE.lastIndex = 0;
  return rich;
}

/** One chat message as YAML-flavoured lines. */
function compactMessageLines(m: CompactMessage): string[] {
  const head = m.tool ? `${m.role} [${m.tool}]` : m.role;
  if (hasRichBlocks(m)) {
    return [`- ${head}:`, ...renderMessageBlocks(m.rawContent).map((ln) => `    ${ln}`)];
  }
  const content = truncate(m.content, 500);
  if (!content.includes("\n")) return [`- ${head}: ${content}`];
  return [`- ${head}: |`, ...content.split("\n").map((line) => `    ${line}`)];
}

/**
 * Pull every distinct `role: system` content from the trace's I/O and any available
 * full-span inputs. Returns deduped strings so the same system prompt that's shared
 * across multiple LLM spans only surfaces once.
 */
function extractSystemMessages(trace: TraceHeader, fullSpans?: FullSpan[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  collectSystemMessages(trace.input, seen, out);
  for (const s of fullSpans ?? []) collectSystemMessages(s.input, seen, out);
  return out;
}

/** Appends the system prompts one payload names, skipping any already seen. */
function collectSystemMessages(
  raw: string | null | undefined,
  seen: Set<string>,
  out: string[],
): void {
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  for (const m of extractChatMessages(parsed)) {
    const content = m.role === "system" ? m.content.trim() : "";
    if (!content || seen.has(content)) continue;
    seen.add(content);
    out.push(content);
  }
}

/** The tool a message names, either by its own name or by answering a call. */
function toolNameOf(message: Record<string, unknown>): string | undefined {
  if (typeof message.name === "string") return message.name;
  return typeof message.tool_call_id === "string" ? "tool_result" : undefined;
}

function extractChatMessages(parsed: unknown): CompactMessage[] {
  if (!Array.isArray(parsed)) return [];
  const out: CompactMessage[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const role = typeof e.role === "string" ? e.role : null;
    if (!role) return []; // Not a message array
    out.push({
      role,
      content: stringifyMessageContent(e.content),
      rawContent: e.content,
      tool: toolNameOf(e),
    });
  }
  return out;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) return content.map(contentBlockText).join(" ");
  return JSON.stringify(content);
}

/** One content block as its single-line preview text. */
function contentBlockText(b: unknown): string {
  if (typeof b === "string") return b;
  if (!b || typeof b !== "object") return String(b);
  const block = b as Record<string, unknown>;
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (block.type === "image" || block.type === "image_url") {
    return "[image]";
  }
  if (block.type === "tool_use" || block.type === "tool_call") {
    const name = typeof block.name === "string" ? block.name : "tool";
    return `[tool:${name}]`;
  }
  if (block.type === "tool_result") {
    return "[tool_result]";
  }
  return JSON.stringify(block);
}

/**
 * Inline thinking-tag patterns we recognise inside plain text content.
 */
const THINKING_TAG_RE = /<(thinking|think|reasoning|reflection)>([\s\S]*?)<\/\1>/gi;

interface TextSegment {
  kind: "text" | "thinking";
  content: string;
}

function splitThinkingFromText(text: string): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  THINKING_TAG_RE.lastIndex = 0;
  for (let match = THINKING_TAG_RE.exec(text); match !== null; match = THINKING_TAG_RE.exec(text)) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ kind: "text", content: before });
    }
    const inner = (match[2] ?? "").trim();
    if (inner) segments.push({ kind: "thinking", content: inner });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ kind: "text", content: remaining });
  }
  // No tag found — return the whole thing as a single text segment.
  if (segments.length === 0) return [{ kind: "text", content: text }];
  return segments;
}

/** Format a thinking string as a markdown-italic line with the 🧠 marker
 *  the DOM walker uses to attach the shimmer + "Thinking" tooltip. */
function thinkingLine(content: string): string {
  const escaped = content.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
  return `*🧠 ${truncate(escaped, 600)}*`;
}

/**
 * Walk a chat message's content and emit YAML-friendly lines per content block.
 */
type Block = Record<string, unknown>;
type BlockRenderer = (block: Block, lines: string[]) => void;

function renderTextBlock(block: Block, lines: string[]): void {
  if (typeof block.text !== "string") {
    lines.push(truncate(JSON.stringify(block), 240));
    return;
  }
  // Some providers stream `<thinking>…</thinking>` inside plain text
  // blocks instead of using a dedicated block type — tease them apart
  // here so they get the same shimmer treatment.
  for (const seg of splitThinkingFromText(block.text)) {
    lines.push(seg.kind === "thinking" ? thinkingLine(seg.content) : seg.content);
  }
}

// Anthropic emits `type: "thinking"` with a `thinking` field; OpenAI
// (Responses / o1 family) emits `type: "reasoning"` with `text` /
// `summary` fields; some intermediates use `redacted_thinking`. Cover
// all three so the shimmer fires uniformly.
function renderThinkingBlock(block: Block, lines: string[]): void {
  const raw =
    (typeof block.thinking === "string" ? block.thinking : null) ??
    (typeof block.reasoning === "string" ? block.reasoning : null) ??
    (typeof block.text === "string" ? block.text : null) ??
    (typeof block.summary === "string" ? block.summary : null) ??
    (block.type === "redacted_thinking" ? "[redacted thinking]" : null);
  if (raw) lines.push(thinkingLine(raw));
}

function renderToolCallBlock(block: Block, lines: string[]): void {
  const name = typeof block.name === "string" ? block.name : "tool";
  const id = typeof block.id === "string" ? ` (${block.id.slice(0, 8)})` : "";
  lines.push(`tool_call: ${name}${id}`);
  const input = (block.input ?? block.arguments ?? block.args) as unknown;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const flat = flattenAttributes(input as Record<string, unknown>);
    for (const ln of flat) lines.push(`  ${ln}`);
  } else if (input != null) {
    lines.push(`  args: ${truncate(String(input))}`);
  }
}

function renderToolResultArrayItem(r: unknown, lines: string[]): void {
  if (typeof r === "string") {
    lines.push(`  - ${truncate(r, 400)}`);
    return;
  }
  if (!r || typeof r !== "object") {
    return;
  }
  const rblock = r as Block;
  if (rblock.type === "text" && typeof rblock.text === "string") {
    for (const ln of rblock.text.split("\n")) {
      lines.push(`  ${truncate(ln, 400)}`);
    }
    return;
  }
  lines.push(`  - ${truncate(JSON.stringify(rblock), 400)}`);
}

function renderToolResultBlock(block: Block, lines: string[]): void {
  const id = typeof block.tool_use_id === "string" ? ` (${block.tool_use_id.slice(0, 8)})` : "";
  lines.push(`tool_result${id}:`);
  const result = block.content;
  if (typeof result === "string") {
    for (const ln of result.split("\n")) {
      lines.push(`  ${truncate(ln, 400)}`);
    }
  } else if (Array.isArray(result)) {
    for (const r of result) {
      renderToolResultArrayItem(r, lines);
    }
  } else if (result && typeof result === "object") {
    const flat = flattenAttributes(result as Record<string, unknown>);
    for (const ln of flat) lines.push(`  ${ln}`);
  }
}

function renderImageBlock(_block: Block, lines: string[]): void {
  lines.push("[image]");
}

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  text: renderTextBlock,
  thinking: renderThinkingBlock,
  reasoning: renderThinkingBlock,
  redacted_thinking: renderThinkingBlock,
  tool_use: renderToolCallBlock,
  tool_call: renderToolCallBlock,
  tool_result: renderToolResultBlock,
  image: renderImageBlock,
  image_url: renderImageBlock,
};

/** Plain text with any inline thinking tags split out into their own lines. */
function textSegmentLines(text: string): string[] {
  return splitThinkingFromText(text).map((seg) =>
    seg.kind === "thinking" ? thinkingLine(seg.content) : seg.content,
  );
}

/** One entry of a content array, through its registered renderer. */
function contentBlockLines(b: unknown): string[] {
  if (typeof b === "string") return textSegmentLines(b);
  if (!b || typeof b !== "object") return [];
  const block = b as Block;
  const renderer = typeof block.type === "string" ? BLOCK_RENDERERS[block.type] : undefined;
  // Fallback: terse JSON for unknown block shapes.
  if (!renderer) return [truncate(JSON.stringify(block), 240)];
  const lines: string[] = [];
  renderer(block, lines);
  return lines;
}

function renderMessageBlocks(content: unknown): string[] {
  if (content == null) return [];
  if (typeof content === "string") return textSegmentLines(content);
  if (!Array.isArray(content)) return [stringifyMessageContent(content)];
  return content.flatMap(contentBlockLines);
}

/**
 * Render an ASCII Gantt waterfall — one row per span, bar positioned by start offset,
 * sized by duration. Uses box-drawing chars so it reads as a proper terminal chart, not
 * a fence-and-dot approximation. Width is fixed for deterministic copy-paste alignment.
 */
function renderSpanTimeline(spans: SpanTreeNode[], width: number): string[] {
  if (spans.length === 0) return [];

  const minStart = Math.min(...spans.map((s) => s.startTimeMs));
  const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
  const total = Math.max(1, maxEnd - minStart);

  // Sort by start so the waterfall reads top-to-bottom in execution order.
  const sorted = [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs);

  const labelMaxLen = Math.min(28, Math.max(...sorted.map((s) => s.name.length), 4));
  const lines: string[] = [];

  for (const span of sorted) {
    const startFrac = (span.startTimeMs - minStart) / total;
    const endFrac = (span.endTimeMs - minStart) / total;
    const startCell = Math.max(0, Math.min(width - 1, Math.floor(startFrac * width)));
    const endCell = Math.max(startCell + 1, Math.min(width, Math.ceil(endFrac * width)));
    const cells: string[] = new Array(width).fill(" ");
    for (let i = startCell; i < endCell; i++) {
      cells[i] = span.status === "error" ? "▓" : "█";
    }
    const label =
      span.name.length > labelMaxLen
        ? span.name.slice(0, labelMaxLen - 1) + "…"
        : span.name.padEnd(labelMaxLen);
    const dur = formatDuration(span.durationMs);
    lines.push(`  ${label} ┤${cells.join("")} ${dur}`);
  }

  // Bottom axis: ┴ at start, ─ between, with start/mid/end time markers.
  const axis = "  " + " ".repeat(labelMaxLen) + " └" + "─".repeat(width);
  lines.push(axis);
  const midDur = formatDuration(total / 2);
  const endDur = formatDuration(total);
  const tickRow =
    "  " +
    " ".repeat(labelMaxLen) +
    "  0" +
    midDur.padStart(Math.floor(width / 2) - 1).padEnd(Math.floor(width / 2)) +
    endDur.padStart(Math.ceil(width / 2) - midDur.length);
  lines.push(tickRow);

  return lines;
}

/** Every span's stack depth, by walking its parent chain. */
function spanDepths(spans: SpanTreeNode[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = new Map<string, number>();
  const depthFor = (s: SpanTreeNode): number => {
    const known = depthOf.get(s.spanId);
    if (known !== undefined) return known;
    const parent = s.parentSpanId ? byId.get(s.parentSpanId) : undefined;
    const d = parent ? depthFor(parent) + 1 : 0;
    depthOf.set(s.spanId, d);
    return d;
  };
  for (const s of spans) depthFor(s);
  return depthOf;
}

const FLAME_SHADES = ["▓", "█", "▒", "░"];

/** One flame row: every span at this depth painted along the time axis. */
function flameRowCells({
  depth,
  depthOf,
  minStart,
  spans,
  total,
  width,
}: {
  depth: number;
  depthOf: Map<string, number>;
  minStart: number;
  spans: SpanTreeNode[];
  total: number;
  width: number;
}): string {
  const cells = new Array<string>(width).fill(" ");
  const fraction = (timeMs: number) => ((timeMs - minStart) / total) * width;
  for (const s of spans) {
    if (depthOf.get(s.spanId) !== depth) continue;
    const start = Math.max(0, Math.min(width - 1, Math.floor(fraction(s.startTimeMs))));
    const end = Math.max(start + 1, Math.max(1, Math.min(width, Math.ceil(fraction(s.endTimeMs)))));
    const glyph = s.status === "error" ? "▓" : FLAME_SHADES[depth % FLAME_SHADES.length]!;
    for (let i = start; i < end; i++) cells[i] = glyph;
  }
  return cells.join("");
}

/**
 * Unicode flame graph — one row per stack depth, spans positioned and sized along the
 * time axis. Uses block characters so the visual lands intact when pasted. Different
 * shading per row (▓/█/▒/░) makes adjacent depths visually distinct.
 */
function renderUnicodeFlame(spans: SpanTreeNode[], width: number): string[] {
  if (spans.length === 0) return [];

  const minStart = Math.min(...spans.map((s) => s.startTimeMs));
  const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
  const total = Math.max(1, maxEnd - minStart);

  const depthOf = spanDepths(spans);
  const maxDepth = Math.max(0, ...Array.from(depthOf.values()));

  // Rows from deepest to shallowest so the call stack reads top-down.
  const lines: string[] = [];
  for (let d = maxDepth; d >= 0; d--) {
    const cells = flameRowCells({ depth: d, depthOf, minStart, spans, total, width });
    lines.push(`d${d} │ ${cells}`);
  }
  // Bottom axis with start/mid/end markers.
  lines.push(`   └${"─".repeat(width)}`);
  const mid = formatDuration(total / 2);
  const end = formatDuration(total);
  lines.push(
    `    0${mid.padStart(Math.floor(width / 2))}${end.padStart(Math.ceil(width / 2) - mid.length)}`,
  );
  return lines;
}

/**
 * Identity strapline: what kind of trace this is, where it ran, and whether it
 * succeeded.
 */
function subtitleParts(trace: TraceHeader): string[] {
  const parts: string[] = [];
  if (trace.origin) parts.push(`**${trace.origin}**`);
  if (trace.serviceName) parts.push(`_${trace.serviceName}_`);
  parts.push(`status: \`${trace.status}\``);
  return parts;
}

/** The metric strip people scan first. */
function quickLookParts(trace: TraceHeader): string[] {
  const parts: string[] = [`⏱️ ${formatDuration(trace.durationMs)}`];
  if (trace.totalTokens > 0) {
    parts.push(
      `🔤 ${trace.totalTokens.toLocaleString()} tokens${trace.tokensEstimated ? "*" : ""}`,
    );
  }
  if ((trace.totalCost ?? 0) > 0) {
    parts.push(`💰 ${formatCost(trace.totalCost ?? 0)}`);
  }
  if (trace.spanCount) {
    parts.push(`📊 ${trace.spanCount} span${trace.spanCount === 1 ? "" : "s"}`);
  }
  if (trace.ttft != null) {
    parts.push(`⚡ TTFT ${formatDuration(trace.ttft)}`);
  }
  return parts;
}

/**
 * Fields with concrete values a reader or a model might quote. Bold-keyed so
 * they read scanably rendered and stay structured for extraction.
 */
function detailParts(trace: TraceHeader): string[] {
  const detail: string[] = [];
  detail.push(`**Trace ID** \`${trace.traceId}\``);
  detail.push(`**Started** ${readableDate(trace.timestamp).toISOString()}`);
  if (trace.totalTokens > 0) {
    detail.push(
      `**Tokens** ${trace.inputTokens ?? 0} in / ${trace.outputTokens ?? 0} out (${trace.totalTokens} total${trace.tokensEstimated ? ", estimated" : ""})`,
    );
  }
  if (trace.models.length > 0) {
    detail.push(`**Models** ${trace.models.map((m) => `\`${m}\``).join(", ")}`);
  }
  if (trace.userId) detail.push(`**User** \`${trace.userId}\``);
  if (trace.conversationId) {
    detail.push(`**Conversation** \`${trace.conversationId}\``);
  }
  const scenarioRunId = trace.scenarioRunId ?? trace.attributes["scenario.run_id"];
  if (scenarioRunId) {
    detail.push(`**Scenario run** \`${scenarioRunId}\``);
  }
  return detail;
}

/**
 * Real markdown so the rendered view has hierarchy: an h1 title, a subtitle
 * strapline, then the metadata as bold-key lines. Two-space line endings keep
 * adjacent fields visually grouped without forcing blank gaps.
 */
function headerLines(trace: TraceHeader): string[] {
  const lines: string[] = [];
  const name = (trace.traceName || undefined) ?? trace.name ?? trace.traceId;
  lines.push(`# ${name}`);
  lines.push("");
  lines.push(`> ${subtitleParts(trace).join(" · ")}`);
  lines.push("");

  const quickLook = quickLookParts(trace);
  if (quickLook.length > 0) {
    lines.push(quickLook.join(" · "));
    lines.push("");
  }

  const detail = detailParts(trace);
  if (detail.length > 0) {
    lines.push(detail.map((d) => `${d}  `).join("\n"));
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  return lines;
}

/**
 * System prompts go straight to the top — they are what most models need to
 * anchor reasoning about the trace, and burying them in the per-span input dump
 * makes them easy to miss.
 */
function systemLines(trace: TraceHeader, fullSpans: FullSpan[] | undefined): string[] {
  const systemPrompts = extractSystemMessages(trace, fullSpans);
  if (systemPrompts.length === 0) return [];

  const lines: string[] = ["# system"];
  for (const prompt of systemPrompts) {
    const body = truncate(prompt, 1500);
    if (!body.includes("\n")) {
      lines.push(`- ${body}`);
      continue;
    }
    lines.push("- |");
    for (const line of body.split("\n")) lines.push(`    ${line}`);
  }
  lines.push("");
  return lines;
}

/** A fenced chart section, empty when the chart renderer produced nothing. */
function fencedLines(heading: string, rendered: string[]): string[] {
  if (rendered.length === 0) return [];
  return [`# ${heading}`, "```", ...rendered, "```", ""];
}

/** One `# input` / `# output` section, compacted for tokens. */
function ioLines(heading: string, raw: string | null | undefined): string[] {
  const compact = compactIO(raw);
  if (compact.length === 0) return [];
  return [`# ${heading}`, ...compact, ""];
}

/**
 * Keep AI spans plus every ancestor of an AI span. Without this a non-AI parent
 * (for example "Scenario Turn", which has no span type) is dropped and its
 * children float up as roots, losing the structure the reader expects.
 */
function spansInScope(
  spans: SpanTreeNode[],
  spanScope: MarkdownConfig["spanScope"],
): SpanTreeNode[] {
  if (spanScope === "all") return spans;
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const keep = new Set<string>();
  for (const s of spans) {
    keepAiSpanAndAncestors(s, byId, keep);
  }
  return spans.filter((s) => keep.has(s.spanId));
}

/** The kept spans bucketed under their kept parent, each bucket in start order. */
function childrenByParentSpan(filtered: SpanTreeNode[]): Map<string | null, SpanTreeNode[]> {
  const childrenByParent = new Map<string | null, SpanTreeNode[]>();
  const filteredIds = new Set(filtered.map((s) => s.spanId));
  for (const span of filtered) {
    const parent =
      span.parentSpanId && filteredIds.has(span.parentSpanId) ? span.parentSpanId : null;
    const arr = childrenByParent.get(parent) ?? [];
    arr.push(span);
    childrenByParent.set(parent, arr);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.startTimeMs - b.startTimeMs);
  }
  return childrenByParent;
}

/**
 * One terse line per span: `  - name (type, dur, model[, error])`. No code
 * fence, no box drawing — a YAML-style indented list.
 */
function spanLine(span: SpanTreeNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const bits: string[] = [span.type ?? "span", formatDuration(span.durationMs)];
  if (span.model) bits.push(span.model);
  if (span.status === "error") bits.push("error");
  return `${indent}- ${span.name} (${bits.join(", ")})`;
}

/** A span's attributes and input/output, as far as the configuration asks for them. */
function spanBodyLines({
  full,
  opts,
  subIndent,
}: {
  full: FullSpan | undefined;
  opts: MarkdownConfig;
  subIndent: string;
}): string[] {
  const lines: string[] = [];
  const section = (heading: string, body: string[]) => {
    if (body.length === 0) return;
    lines.push(`${subIndent}${heading}:`);
    for (const ln of body) lines.push(`${subIndent}  ${ln}`);
  };

  if (opts.includeSpanAttributes && full?.params) {
    section("attributes", flattenAttributes(full.params as Record<string, unknown>));
  }
  if (opts.includeSpanIO && full?.input) {
    section("input", compactIO(full.input));
  }
  if (opts.includeSpanIO && full?.output) {
    section("output", compactIO(full.output));
  }
  return lines;
}

/** The `# spans` section: the kept span tree, depth-first, each with its body. */
function spansLines({
  fullSpans,
  opts,
  spans,
  trace,
}: {
  fullSpans: FullSpan[] | undefined;
  opts: MarkdownConfig;
  spans: SpanTreeNode[];
  trace: TraceHeader;
}): string[] {
  const filtered = spansInScope(spans, opts.spanScope);
  if (filtered.length === 0) return [];

  const childrenByParent = childrenByParentSpan(filtered);
  const fullById = new Map<string, FullSpan>();
  for (const fs of fullSpans ?? []) fullById.set(fs.spanId, fs);

  const lines: string[] = ["# spans"];
  const writeSpan = (span: SpanTreeNode, depth: number) => {
    lines.push(spanLine(span, depth));
    const subIndent = "  ".repeat(depth + 1);
    if (opts.spanDetail === "full") {
      const offsetMs = Math.max(0, Math.round(span.startTimeMs - trace.timestamp));
      lines.push(`${subIndent}id: ${span.spanId.slice(0, 16)} · +${offsetMs}ms`);
    }
    lines.push(...spanBodyLines({ full: fullById.get(span.spanId), opts, subIndent }));
    for (const kid of childrenByParent.get(span.spanId) ?? []) {
      writeSpan(kid, depth + 1);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    writeSpan(root, 0);
  }
  lines.push("");
  return lines;
}

/** The `# events` section, each event offset from the trace start. */
function eventsLines(trace: TraceHeader, events: DerivedTraceEvent[]): string[] {
  if (events.length === 0) return [];
  const lines: string[] = ["# events"];
  for (const evt of events) {
    const offsetMs = Math.max(0, Math.round(evt.timestamp - trace.timestamp));
    lines.push(`  - ${evt.name} (+${offsetMs}ms)`);
  }
  lines.push("");
  return lines;
}

/** The `# metadata` section: the trace's own attributes, flattened. */
function metadataLines(trace: TraceHeader): string[] {
  if (Object.keys(trace.attributes).length === 0) return [];
  const flat = flattenAttributes(trace.attributes);
  if (flat.length === 0) return [];
  return ["# metadata", ...flat, ""];
}

export function buildTraceMarkdown(
  trace: TraceHeader,
  spans: SpanTreeNode[],
  opts: MarkdownConfig,
  fullSpans?: FullSpan[],
  events: DerivedTraceEvent[] = [],
): string {
  const lines: string[] = [...headerLines(trace), ...systemLines(trace, fullSpans)];

  if (trace.status === "error" && trace.error) {
    lines.push("# error", truncate(trace.error, 800), "");
  }

  // The Unicode charts are opt-in from the Configure popover, since charts
  // cost tokens.
  if (opts.includeWaterfall && spans.length > 0) {
    lines.push(...fencedLines("waterfall", renderSpanTimeline(spans, 48)));
  }
  if (opts.includeFlame && spans.length > 0) {
    lines.push(...fencedLines("flame", renderUnicodeFlame(spans, 48)));
  }

  if (opts.includeIO && trace.input) lines.push(...ioLines("input", trace.input));
  if (opts.includeIO && trace.output) lines.push(...ioLines("output", trace.output));

  if (opts.spanScope !== "none" && spans.length > 0) {
    lines.push(...spansLines({ fullSpans, opts, spans, trace }));
  }

  lines.push(...eventsLines(trace, events));
  if (opts.includeMetadata) lines.push(...metadataLines(trace));

  return lines.join("\n").trim();
}

export interface TraceMarkdownChunk {
  /** Stable key for virtualization. */
  id: string;
  /** Markdown source for this section. */
  markdown: string;
}

/**
 * Split a trace markdown blob into chunks at top-level heading boundaries (`# `) so a
 * virtualized list can mount one section at a time.
 */
export function splitTraceMarkdown(markdown: string): TraceMarkdownChunk[] {
  if (!markdown) return [];
  const lines = markdown.split("\n");
  const chunks: TraceMarkdownChunk[] = [];
  let current: string[] = [];
  let currentId = "preamble";
  let counter = 0;
  const flush = () => {
    if (current.length === 0) return;
    const body = current.join("\n").replace(/\s+$/, "");
    if (body.length > 0) chunks.push({ id: currentId, markdown: body });
    current = [];
  };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      flush();
      counter += 1;
      currentId = `${counter}-${line.slice(2).trim() || "section"}`;
    }
    current.push(line);
  }
  flush();
  return chunks;
}
