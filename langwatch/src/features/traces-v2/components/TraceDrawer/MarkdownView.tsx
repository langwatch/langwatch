import {
  Box,
  Button,
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  Flex,
  Heading,
  HStack,
  Icon,
  Link,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import { LuCheck, LuCopy, LuSettings2 } from "react-icons/lu";

const thinkingShimmer = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`;
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import { Checkbox } from "~/components/ui/checkbox";
import { Radio, RadioGroup } from "~/components/ui/radio";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { codeToHtml, createHighlighter, type HighlighterGeneric } from "shiki";
import type {
  TraceHeader,
  SpanTreeNode,
  SpanDetail as FullSpan,
} from "~/server/api/routers/tracesV2.schemas";
import { useColorMode } from "~/components/ui/color-mode";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
} from "../../utils/formatters";
import { SegmentedToggle } from "./SegmentedToggle";

export type SpanScope = "none" | "ai" | "all";
export type SpanDetailLevel = "names" | "core" | "full";
export type SpanLayout = "bullets" | "tree";

export interface MarkdownConfig {
  spanScope: SpanScope;
  spanDetail: SpanDetailLevel;
  spanLayout: SpanLayout;
  includeIO: boolean;
  includeMetadata: boolean;
  includeSpanIO: boolean;
  includeSpanAttributes: boolean;
  /** Include a Unicode waterfall chart (Gantt-style block-character bars). */
  includeWaterfall: boolean;
  /** Include a Unicode flame graph (one row per stack depth). */
  includeFlame: boolean;
}

export const DEFAULT_MARKDOWN_CONFIG: MarkdownConfig = {
  spanScope: "ai",
  spanDetail: "core",
  spanLayout: "tree",
  includeIO: true,
  includeMetadata: false,
  includeSpanIO: false,
  includeSpanAttributes: false,
  includeWaterfall: false,
  includeFlame: false,
};

interface MarkdownViewProps {
  trace: TraceHeader | null;
  spans: SpanTreeNode[];
  fullSpans?: FullSpan[];
  config: MarkdownConfig;
}

const AI_SPAN_TYPES = new Set(["llm", "agent", "rag", "tool", "evaluation"]);

function indent(text: string, depth: number): string {
  if (depth === 0) return text;
  const pad = "  ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/**
 * Render a horizontal bar of fixed width that visually splits two parts.
 * Uses block-shading glyphs so it survives copy-paste into any LLM context.
 */
function renderSplitBar(left: number, right: number, width: number): string {
  const total = left + right;
  if (total <= 0 || width <= 0) return "";
  const leftCells = Math.max(
    left > 0 ? 1 : 0,
    Math.min(width, Math.round((left / total) * width)),
  );
  const rightCells = Math.max(0, width - leftCells);
  return "█".repeat(leftCells) + "▒".repeat(rightCells);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
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
 * Flatten a nested object to dot-path key:value lines, YAML-flavoured. We
 * drop noise keys, compact arrays inline when small, and truncate long
 * strings — the goal is to give the LLM enough signal without blowing the
 * context window with framework boilerplate.
 */
function flattenAttributes(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isNoisyKey(path)) continue;
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      const inline = v.map((x) =>
        typeof x === "object" && x != null ? JSON.stringify(x) : String(x),
      );
      const joined = inline.join(", ");
      if (joined.length <= 120) {
        out.push(`${path}: [${truncate(joined, 120)}]`);
      } else {
        // Long arrays — render per-item with `-` to stay readable
        out.push(`${path}:`);
        for (const item of inline) out.push(`  - ${truncate(item)}`);
      }
      continue;
    }
    if (typeof v === "object") {
      out.push(...flattenAttributes(v as Record<string, unknown>, path));
      continue;
    }
    out.push(`${path}: ${truncate(String(v))}`);
  }
  return out;
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
  if (messages.length === 0) {
    // Some other JSON payload — render as flat key: value lines if it's
    // an object, else just stringify it compactly.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return flattenAttributes(parsed as Record<string, unknown>);
    }
    return [truncate(JSON.stringify(parsed), 600)];
  }

  const out: string[] = [];
  for (const m of messages) {
    const head = m.tool ? `${m.role} [${m.tool}]` : m.role;

    // If the message carries structured blocks (thinking, tool_use,
    // tool_result, mixed text), expand them as nested YAML so each block
    // is independently inspectable. We also expand when the raw string
    // content holds inline thinking tags so the shimmer treatment kicks
    // in for those messages too.
    const hasRichBlocks =
      (Array.isArray(m.rawContent) &&
        m.rawContent.some(
          (b) =>
            b &&
            typeof b === "object" &&
            [
              "thinking",
              "reasoning",
              "redacted_thinking",
              "tool_use",
              "tool_call",
              "tool_result",
            ].includes((b as Record<string, unknown>).type as string),
        )) ||
      (typeof m.rawContent === "string" &&
        THINKING_TAG_RE.test(m.rawContent));
    // Reset regex lastIndex — `THINKING_TAG_RE` is global so test() advances it.
    THINKING_TAG_RE.lastIndex = 0;

    if (hasRichBlocks) {
      out.push(`- ${head}:`);
      for (const ln of renderMessageBlocks(m.rawContent)) {
        out.push(`    ${ln}`);
      }
      continue;
    }

    const content = truncate(m.content, 500);
    if (content.includes("\n")) {
      out.push(`- ${head}: |`);
      for (const line of content.split("\n")) out.push(`    ${line}`);
    } else {
      out.push(`- ${head}: ${content}`);
    }
  }
  return out;
}

/**
 * Pull every distinct `role: system` content from the trace's I/O and any
 * available full-span inputs. Returns deduped strings so the same system
 * prompt that's shared across multiple LLM spans only surfaces once.
 *
 * The system prompt is the most useful single anchor for an LLM trying to
 * reason about a trace — it tells the model what the agent was *supposed*
 * to do. Surfacing it as its own block at the top makes that obvious
 * without forcing the consumer to scroll the full input list.
 */
function extractSystemMessages(
  trace: TraceHeader,
  fullSpans?: FullSpan[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const tryExtract = (raw: string | null | undefined) => {
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const messages = extractChatMessages(parsed);
    for (const m of messages) {
      if (m.role !== "system") continue;
      const content = m.content.trim();
      if (!content) continue;
      if (seen.has(content)) continue;
      seen.add(content);
      out.push(content);
    }
  };

  tryExtract(trace.input);
  for (const s of fullSpans ?? []) tryExtract(s.input);
  return out;
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
      tool:
        typeof e.name === "string"
          ? (e.name as string)
          : typeof e.tool_call_id === "string"
            ? "tool_result"
            : undefined,
    });
  }
  return out;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
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
        return String(b);
      })
      .join(" ");
  }
  return JSON.stringify(content);
}

/**
 * Inline thinking-tag patterns we recognise inside plain text content.
 * Different models / SDKs surface "thinking" in different shapes — block
 * types (Anthropic's `thinking`, OpenAI's `reasoning`), and inline tags
 * (`<thinking>…</thinking>`, `<think>…</think>`, `<reflection>…</reflection>`).
 * We strip them out of the surrounding text and re-emit them as proper
 * thinking lines so the shimmer + tooltip apply uniformly.
 */
const THINKING_TAG_RE =
  /<(thinking|think|reasoning|reflection)>([\s\S]*?)<\/\1>/gi;

interface TextSegment {
  kind: "text" | "thinking";
  content: string;
}

function splitThinkingFromText(text: string): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  THINKING_TAG_RE.lastIndex = 0;
  while ((match = THINKING_TAG_RE.exec(text)) !== null) {
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
  const escaped = content.replace(/\*/g, "\\*");
  return `*🧠 ${truncate(escaped, 600)}*`;
}

/**
 * Walk a chat message's content and emit YAML-friendly lines per content
 * block. Used by `compactIO` so an `assistant` turn that contains a
 * thinking block + a tool call + an answer renders as multiple expanded
 * sub-lines instead of one squished `[tool:foo]` placeholder.
 *
 * Block treatments:
 * - `text` → inline text, with `<thinking>` / `<reasoning>` / `<think>`
 *   tags split out as proper thinking lines
 * - `thinking` / `reasoning` / `redacted_thinking` → markdown italics with
 *   a 🧠 marker so the rendered viewer can shimmer + label them
 * - `tool_use` / `tool_call` → name + flattened `input`/`arguments`
 * - `tool_result` → tool_use_id link + flattened or quoted content
 * - `image` → `[image]`
 * - anything else → compact JSON
 */
function renderMessageBlocks(content: unknown): string[] {
  if (content == null) return [];
  if (typeof content === "string") {
    // Plain string — split out any inline thinking tags before emitting.
    return splitThinkingFromText(content).map((seg) =>
      seg.kind === "thinking" ? thinkingLine(seg.content) : seg.content,
    );
  }
  if (!Array.isArray(content)) {
    return [stringifyMessageContent(content)];
  }

  const lines: string[] = [];
  for (const b of content) {
    if (typeof b === "string") {
      for (const seg of splitThinkingFromText(b)) {
        lines.push(seg.kind === "thinking" ? thinkingLine(seg.content) : seg.content);
      }
      continue;
    }
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      // Some providers stream `<thinking>…</thinking>` inside plain text
      // blocks instead of using a dedicated block type — tease them apart
      // here so they get the same shimmer treatment.
      for (const seg of splitThinkingFromText(block.text)) {
        lines.push(seg.kind === "thinking" ? thinkingLine(seg.content) : seg.content);
      }
      continue;
    }

    // Anthropic emits `type: "thinking"` with a `thinking` field; OpenAI
    // (Responses / o1 family) emits `type: "reasoning"` with `text` /
    // `summary` fields; some intermediates use `redacted_thinking`. Cover
    // all three so the shimmer fires uniformly.
    if (
      block.type === "thinking" ||
      block.type === "reasoning" ||
      block.type === "redacted_thinking"
    ) {
      const raw =
        (typeof block.thinking === "string" ? block.thinking : null) ??
        (typeof block.reasoning === "string" ? block.reasoning : null) ??
        (typeof block.text === "string" ? block.text : null) ??
        (typeof block.summary === "string" ? block.summary : null) ??
        (block.type === "redacted_thinking" ? "[redacted thinking]" : null);
      if (raw) lines.push(thinkingLine(raw));
      continue;
    }

    if (block.type === "tool_use" || block.type === "tool_call") {
      const name = typeof block.name === "string" ? block.name : "tool";
      const id =
        typeof block.id === "string" ? ` (${block.id.slice(0, 8)})` : "";
      lines.push(`tool_call: ${name}${id}`);
      const input = (block.input ?? block.arguments ?? block.args) as unknown;
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const flat = flattenAttributes(input as Record<string, unknown>);
        for (const ln of flat) lines.push(`  ${ln}`);
      } else if (input != null) {
        lines.push(`  args: ${truncate(String(input))}`);
      }
      continue;
    }

    if (block.type === "tool_result") {
      const id =
        typeof block.tool_use_id === "string"
          ? ` (${block.tool_use_id.slice(0, 8)})`
          : "";
      lines.push(`tool_result${id}:`);
      const result = block.content;
      if (typeof result === "string") {
        for (const ln of result.split("\n")) {
          lines.push(`  ${truncate(ln, 400)}`);
        }
      } else if (Array.isArray(result)) {
        for (const r of result) {
          if (typeof r === "string") {
            lines.push(`  - ${truncate(r, 400)}`);
          } else if (r && typeof r === "object") {
            const rblock = r as Record<string, unknown>;
            if (
              rblock.type === "text" &&
              typeof rblock.text === "string"
            ) {
              for (const ln of rblock.text.split("\n")) {
                lines.push(`  ${truncate(ln, 400)}`);
              }
            } else {
              lines.push(`  - ${truncate(JSON.stringify(rblock), 400)}`);
            }
          }
        }
      } else if (result && typeof result === "object") {
        const flat = flattenAttributes(result as Record<string, unknown>);
        for (const ln of flat) lines.push(`  ${ln}`);
      }
      continue;
    }

    if (block.type === "image" || block.type === "image_url") {
      lines.push("[image]");
      continue;
    }

    // Fallback: terse JSON for unknown block shapes.
    lines.push(truncate(JSON.stringify(block), 240));
  }
  return lines;
}

/**
 * Render an ASCII Gantt waterfall — one row per span, bar positioned by
 * start offset, sized by duration. Uses box-drawing chars so it reads as a
 * proper terminal chart, not a fence-and-dot approximation. Width is fixed
 * for deterministic copy-paste alignment.
 */
function renderSpanTimeline(
  spans: SpanTreeNode[],
  width: number,
): string[] {
  if (spans.length === 0) return [];

  const minStart = Math.min(...spans.map((s) => s.startTimeMs));
  const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
  const total = Math.max(1, maxEnd - minStart);

  // Sort by start so the waterfall reads top-to-bottom in execution order.
  const sorted = [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs);

  const labelMaxLen = Math.min(
    28,
    Math.max(...sorted.map((s) => s.name.length), 4),
  );
  const lines: string[] = [];

  for (const span of sorted) {
    const startFrac = (span.startTimeMs - minStart) / total;
    const endFrac = (span.endTimeMs - minStart) / total;
    const startCell = Math.max(0, Math.min(width - 1, Math.floor(startFrac * width)));
    const endCell = Math.max(
      startCell + 1,
      Math.min(width, Math.ceil(endFrac * width)),
    );
    const cells: string[] = new Array(width).fill(" ");
    for (let i = startCell; i < endCell; i++) {
      cells[i] = span.status === "error" ? "▓" : "█";
    }
    const label = span.name.length > labelMaxLen
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

/**
 * Minimal asciichart-style line plot — same character set as the terminal
 * dashboards we're modelling after (`╭╮╯╰─│┤┼`). Renders `series` (≥ 2
 * points) into `height` rows with a Y-axis label column. Pure: no DOM, no
 * theme — just text that survives copy-paste.
 */
function renderLineChart(
  series: number[],
  height: number,
  formatY: (v: number) => string,
): string[] {
  if (series.length < 2 || height < 2) return [];

  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const w = series.length;

  // Build the plot grid (rows[0] is the top of the chart).
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: w }, () => " "),
  );
  const rowFor = (v: number): number =>
    Math.round((1 - (v - min) / range) * (height - 1));

  for (let x = 0; x < w; x++) {
    const v = series[x]!;
    const r = rowFor(v);
    if (x === 0) {
      grid[r]![x] = "┤";
      continue;
    }
    const prev = rowFor(series[x - 1]!);
    if (prev === r) {
      grid[r]![x] = "─";
    } else if (prev > r) {
      // line moves up between cells
      grid[prev]![x] = "╯";
      grid[r]![x] = "╭";
      for (let rr = r + 1; rr < prev; rr++) grid[rr]![x] = "│";
    } else {
      // line moves down
      grid[prev]![x] = "╮";
      grid[r]![x] = "╰";
      for (let rr = prev + 1; rr < r; rr++) grid[rr]![x] = "│";
    }
  }

  // Y-axis labels on a few rows so it reads like the example chart.
  const ticks: number[] = [];
  if (height >= 4) {
    ticks.push(0, Math.floor(height / 2), height - 1);
  } else {
    ticks.push(0, height - 1);
  }
  const labelWidth = Math.max(
    ...ticks.map((r) => formatY(max - (r / (height - 1)) * range).length),
    1,
  );
  const lines: string[] = [];
  for (let r = 0; r < height; r++) {
    const isTick = ticks.includes(r);
    const label = isTick
      ? formatY(max - (r / (height - 1)) * range).padStart(labelWidth)
      : " ".repeat(labelWidth);
    lines.push(`  ${label} ┤${grid[r]!.join("")}`);
  }
  // Bottom axis row using ┼ at origin and ─ across.
  lines.push(`  ${"0".padStart(labelWidth)} ┼${"─".repeat(w)}`);
  return lines;
}

/**
 * Unicode flame graph — one row per stack depth, spans positioned and
 * sized along the time axis. Uses block characters so the visual lands
 * intact when pasted. Different shading per row (▓/█/▒/░) makes adjacent
 * depths visually distinct.
 *
 * Layout (deepest at top, shallowest at bottom — call-stack-style):
 *   d3:        ▓▓▓▓
 *   d2:    ████████████
 *   d1: ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
 *   d0: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 *       ↑ time axis →
 */
function renderUnicodeFlame(spans: SpanTreeNode[], width: number): string[] {
  if (spans.length === 0) return [];

  const minStart = Math.min(...spans.map((s) => s.startTimeMs));
  const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
  const total = Math.max(1, maxEnd - minStart);

  // Compute depth for every span by walking parent chain.
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = new Map<string, number>();
  const computeDepth = (s: SpanTreeNode): number => {
    if (depthOf.has(s.spanId)) return depthOf.get(s.spanId)!;
    if (!s.parentSpanId || !byId.has(s.parentSpanId)) {
      depthOf.set(s.spanId, 0);
      return 0;
    }
    const d = computeDepth(byId.get(s.parentSpanId)!) + 1;
    depthOf.set(s.spanId, d);
    return d;
  };
  for (const s of spans) computeDepth(s);

  const maxDepth = Math.max(0, ...Array.from(depthOf.values()));
  const cellFor = (timeMs: number): number =>
    Math.max(0, Math.min(width - 1, Math.floor(((timeMs - minStart) / total) * width)));
  const endCellFor = (timeMs: number): number =>
    Math.max(1, Math.min(width, Math.ceil(((timeMs - minStart) / total) * width)));

  // Rows from deepest to shallowest so the call stack reads top-down.
  const lines: string[] = [];
  const SHADES = ["▓", "█", "▒", "░"];
  for (let d = maxDepth; d >= 0; d--) {
    const cells = new Array<string>(width).fill(" ");
    for (const s of spans) {
      if (depthOf.get(s.spanId) !== d) continue;
      const start = cellFor(s.startTimeMs);
      const end = Math.max(start + 1, endCellFor(s.endTimeMs));
      const glyph = s.status === "error" ? "▓" : SHADES[d % SHADES.length]!;
      for (let i = start; i < end; i++) cells[i] = glyph;
    }
    lines.push(`d${d} │ ${cells.join("")}`);
  }
  // Bottom axis with start/mid/end markers.
  lines.push(
    `   └${"─".repeat(width)}`,
  );
  const mid = formatDuration(total / 2);
  const end = formatDuration(total);
  lines.push(
    `    0${mid.padStart(Math.floor(width / 2))}${end.padStart(Math.ceil(width / 2) - mid.length)}`,
  );
  return lines;
}

/**
 * Tiny horizontal bar chart of span counts by type. Each row scales to a
 * 30-cell maximum so the layout stays predictable.
 */
function renderSpanTypeBreakdown(spans: SpanTreeNode[]): string[] {
  if (spans.length === 0) return [];
  const counts = new Map<string, number>();
  for (const s of spans) {
    const t = (s.type ?? "span").toLowerCase();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 0;
  if (max === 0) return [];
  const labelLen = Math.max(...entries.map(([k]) => k.length), 4);
  const barWidth = 30;
  const lines: string[] = [];
  for (const [type, n] of entries) {
    const cells = Math.max(1, Math.round((n / max) * barWidth));
    lines.push(
      `  ${type.padEnd(labelLen)} ┤${"█".repeat(cells)}${" ".repeat(barWidth - cells)} ${n}`,
    );
  }
  return lines;
}

export function buildTraceMarkdown(
  trace: TraceHeader,
  spans: SpanTreeNode[],
  opts: MarkdownConfig,
  fullSpans?: FullSpan[],
): string {
  const lines: string[] = [];

  // Header — real markdown so the rendered view has hierarchy: an h1
  // title, a subtitle strapline (origin · service · status), then the
  // metadata as bold-key lines. Two-space line endings keep adjacent
  // fields on visually-grouped lines without forcing blank gaps.
  const name = trace.rootSpanName ?? trace.name ?? trace.traceId;
  lines.push(`# ${name}`);
  lines.push("");

  // Subtitle: identity strapline. Reads at a glance what kind of trace
  // this is, where it ran, and whether it succeeded.
  const subtitleParts: string[] = [];
  if (trace.origin) subtitleParts.push(`**${trace.origin}**`);
  if (trace.serviceName) subtitleParts.push(`_${trace.serviceName}_`);
  subtitleParts.push(`status: \`${trace.status}\``);
  lines.push(`> ${subtitleParts.join(" · ")}`);
  lines.push("");

  // Quick-look metric strip — the numbers people scan first.
  const quickLook: string[] = [];
  quickLook.push(`⏱️ ${formatDuration(trace.durationMs)}`);
  if (trace.totalTokens > 0) {
    quickLook.push(
      `🔤 ${trace.totalTokens.toLocaleString()} tokens${trace.tokensEstimated ? "*" : ""}`,
    );
  }
  if ((trace.totalCost ?? 0) > 0) {
    quickLook.push(`💰 ${formatCost(trace.totalCost ?? 0)}`);
  }
  if (trace.spanCount) {
    quickLook.push(`📊 ${trace.spanCount} span${trace.spanCount === 1 ? "" : "s"}`);
  }
  if (trace.ttft != null) {
    quickLook.push(`⚡ TTFT ${formatDuration(trace.ttft)}`);
  }
  if (quickLook.length > 0) {
    lines.push(quickLook.join(" · "));
    lines.push("");
  }

  // Detail block — fields with concrete values that the LLM (or a human)
  // might quote. Keep them bold-keyed so they read scanably in rendered
  // markdown and stay structured for token-efficient extraction.
  const detail: string[] = [];
  detail.push(`**Trace ID** \`${trace.traceId}\``);
  detail.push(`**Started** ${new Date(trace.timestamp).toISOString()}`);
  if (trace.totalTokens > 0) {
    detail.push(
      `**Tokens** ${trace.inputTokens ?? 0} in / ${trace.outputTokens ?? 0} out (${trace.totalTokens} total${trace.tokensEstimated ? ", estimated" : ""})`,
    );
  }
  if (trace.models.length > 0) {
    detail.push(
      `**Models** ${trace.models.map((m) => `\`${m}\``).join(", ")}`,
    );
  }
  if (trace.userId) detail.push(`**User** \`${trace.userId}\``);
  if (trace.conversationId) {
    detail.push(`**Conversation** \`${trace.conversationId}\``);
  }
  const scenarioRunId =
    trace.scenarioRunId ?? trace.attributes["scenario.run_id"];
  if (scenarioRunId) {
    detail.push(`**Scenario run** \`${scenarioRunId}\``);
  }
  if (detail.length > 0) {
    // Two-space line endings — stay on adjacent visual lines without
    // forcing a blank-line paragraph break between each field.
    lines.push(detail.map((d) => `${d}  `).join("\n"));
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // System prompts go straight to the top — they're what most LLMs need
  // to anchor reasoning about the trace ("what was this agent told to do?")
  // and burying them in the per-span input dump makes them easy to miss.
  const systemPrompts = extractSystemMessages(trace, fullSpans);
  if (systemPrompts.length > 0) {
    lines.push("# system");
    for (const prompt of systemPrompts) {
      const body = truncate(prompt, 1500);
      if (body.includes("\n")) {
        lines.push("- |");
        for (const line of body.split("\n")) lines.push(`    ${line}`);
      } else {
        lines.push(`- ${body}`);
      }
    }
    lines.push("");
  }

  if (trace.status === "error" && trace.error) {
    lines.push("# error");
    lines.push(truncate(trace.error, 800));
    lines.push("");
  }

  // Optional Unicode waterfall — only when the user explicitly opts in via
  // the Configure popover, since charts cost tokens.
  if (opts.includeWaterfall && spans.length > 0) {
    const wf = renderSpanTimeline(spans, 48);
    if (wf.length > 0) {
      lines.push("# waterfall");
      lines.push("```");
      for (const ln of wf) lines.push(ln);
      lines.push("```");
      lines.push("");
    }
  }

  // Optional Unicode flame graph — same gating, separate chart.
  if (opts.includeFlame && spans.length > 0) {
    const fg = renderUnicodeFlame(spans, 48);
    if (fg.length > 0) {
      lines.push("# flame");
      lines.push("```");
      for (const ln of fg) lines.push(ln);
      lines.push("```");
      lines.push("");
    }
  }

  if (opts.includeIO && trace.input) {
    const compact = compactIO(trace.input);
    if (compact.length > 0) {
      lines.push("# input");
      for (const ln of compact) lines.push(ln);
      lines.push("");
    }
  }

  if (opts.includeIO && trace.output) {
    const compact = compactIO(trace.output);
    if (compact.length > 0) {
      lines.push("# output");
      for (const ln of compact) lines.push(ln);
      lines.push("");
    }
  }

  if (opts.spanScope !== "none" && spans.length > 0) {
    let filtered: SpanTreeNode[];
    if (opts.spanScope === "all") {
      filtered = spans;
    } else {
      // Keep AI spans plus every ancestor of an AI span. Without this, a
      // non-AI parent (e.g. "Scenario Turn", which has no span-type) gets
      // dropped and its children float up as roots — losing the structure
      // the user expects to see in the markdown.
      const byId = new Map(spans.map((s) => [s.spanId, s]));
      const keep = new Set<string>();
      for (const s of spans) {
        if (!AI_SPAN_TYPES.has((s.type ?? "span").toLowerCase())) continue;
        keep.add(s.spanId);
        let parentId = s.parentSpanId;
        while (parentId && !keep.has(parentId)) {
          const parent = byId.get(parentId);
          if (!parent) break;
          keep.add(parent.spanId);
          parentId = parent.parentSpanId;
        }
      }
      filtered = spans.filter((s) => keep.has(s.spanId));
    }

    if (filtered.length > 0) {
      lines.push("# spans");

      const childrenByParent = new Map<string | null, SpanTreeNode[]>();
      const filteredIds = new Set(filtered.map((s) => s.spanId));
      for (const span of filtered) {
        const parent =
          span.parentSpanId && filteredIds.has(span.parentSpanId)
            ? span.parentSpanId
            : null;
        const arr = childrenByParent.get(parent) ?? [];
        arr.push(span);
        childrenByParent.set(parent, arr);
      }
      for (const arr of childrenByParent.values()) {
        arr.sort((a, b) => a.startTimeMs - b.startTimeMs);
      }

      const fullById = new Map<string, FullSpan>();
      for (const fs of fullSpans ?? []) fullById.set(fs.spanId, fs);

      // One terse line per span: `  - name (type, dur, model[, error])`
      // No code fence, no box-drawing — just YAML-style indented list.
      const renderSpanLine = (span: SpanTreeNode, depth: number): string => {
        const indent = "  ".repeat(depth);
        const bits: string[] = [span.type ?? "span", formatDuration(span.durationMs)];
        if (span.model) bits.push(abbreviateModel(span.model));
        if (span.status === "error") bits.push("error");
        return `${indent}- ${span.name} (${bits.join(", ")})`;
      };

      const writeSpan = (span: SpanTreeNode, depth: number) => {
        lines.push(renderSpanLine(span, depth));

        const full = fullById.get(span.spanId);
        const subIndent = "  ".repeat(depth + 1);

        if (opts.spanDetail === "full") {
          const offsetMs = Math.max(
            0,
            Math.round(span.startTimeMs - trace.timestamp),
          );
          lines.push(
            `${subIndent}id: ${span.spanId.slice(0, 16)} · +${offsetMs}ms`,
          );
        }

        if (opts.includeSpanAttributes && full?.params) {
          const flat = flattenAttributes(full.params as Record<string, unknown>);
          if (flat.length > 0) {
            lines.push(`${subIndent}attributes:`);
            for (const ln of flat) lines.push(`${subIndent}  ${ln}`);
          }
        }
        if (opts.includeSpanIO && full?.input) {
          const compact = compactIO(full.input);
          if (compact.length > 0) {
            lines.push(`${subIndent}input:`);
            for (const ln of compact) lines.push(`${subIndent}  ${ln}`);
          }
        }
        if (opts.includeSpanIO && full?.output) {
          const compact = compactIO(full.output);
          if (compact.length > 0) {
            lines.push(`${subIndent}output:`);
            for (const ln of compact) lines.push(`${subIndent}  ${ln}`);
          }
        }

        for (const kid of childrenByParent.get(span.spanId) ?? []) {
          writeSpan(kid, depth + 1);
        }
      };

      for (const root of childrenByParent.get(null) ?? []) {
        writeSpan(root, 0);
      }
      lines.push("");
    }
  }

  if (trace.events && trace.events.length > 0) {
    lines.push("# events");
    for (const evt of trace.events) {
      const offsetMs = Math.max(0, Math.round(evt.timestamp - trace.timestamp));
      lines.push(`  - ${evt.name} (+${offsetMs}ms)`);
    }
    lines.push("");
  }

  if (opts.includeMetadata && Object.keys(trace.attributes).length > 0) {
    const flat = flattenAttributes(trace.attributes);
    if (flat.length > 0) {
      lines.push("# metadata");
      for (const ln of flat) lines.push(ln);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

type ViewMode = "rendered" | "source";

export function MarkdownConfigurePopover({
  config,
  onChange,
  placement = "bottom-end",
}: {
  config: MarkdownConfig;
  onChange: (next: MarkdownConfig) => void;
  placement?: "top-start" | "bottom-end";
}) {
  return (
    <PopoverRoot positioning={{ placement }}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          colorPalette="blue"
          paddingX={2}
          height="24px"
          gap={1}
        >
          <Icon as={LuSettings2} boxSize={3} />
          <Text textStyle="2xs" fontWeight="semibold">
            Configure
          </Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverArrow />
        <PopoverBody padding={2.5}>
          <VStack align="stretch" gap={2.5}>
            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Sections
              </Text>
              <Checkbox
                size="xs"
                checked={config.includeIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeIO: checked === true })
                }
              >
                <Text textStyle="xs">Input / Output</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeMetadata}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeMetadata: checked === true })
                }
              >
                <Text textStyle="xs">Metadata</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeSpanIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeSpanIO: checked === true })
                }
              >
                <Text textStyle="xs">Per-span input / output</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeSpanAttributes}
                onCheckedChange={({ checked }) =>
                  onChange({
                    ...config,
                    includeSpanAttributes: checked === true,
                  })
                }
              >
                <Text textStyle="xs">Per-span attributes</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeWaterfall}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeWaterfall: checked === true })
                }
              >
                <Text textStyle="xs">Unicode waterfall</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeFlame}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeFlame: checked === true })
                }
              >
                <Text textStyle="xs">Unicode flame graph</Text>
              </Checkbox>
            </VStack>

            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Spans · scope
              </Text>
              <RadioGroup
                size="xs"
                value={config.spanScope}
                onValueChange={({ value }) =>
                  onChange({ ...config, spanScope: value as SpanScope })
                }
              >
                <VStack align="stretch" gap={1}>
                  <Radio value="none">
                    <Text textStyle="xs">No spans</Text>
                  </Radio>
                  <Radio value="ai">
                    <Text textStyle="xs">AI spans only</Text>
                  </Radio>
                  <Radio value="all">
                    <Text textStyle="xs">All spans</Text>
                  </Radio>
                </VStack>
              </RadioGroup>
            </VStack>

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · detail
                </Text>
                <RadioGroup
                  size="xs"
                  value={config.spanDetail}
                  onValueChange={({ value }) =>
                    onChange({
                      ...config,
                      spanDetail: value as SpanDetailLevel,
                    })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="names">
                      <Text textStyle="xs">Names only</Text>
                    </Radio>
                    <Radio value="core">
                      <Text textStyle="xs">+ duration, model, status</Text>
                    </Radio>
                    <Radio value="full">
                      <Text textStyle="xs">+ span IDs, timing</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · layout
                </Text>
                <RadioGroup
                  size="xs"
                  value={config.spanLayout}
                  onValueChange={({ value }) =>
                    onChange({ ...config, spanLayout: value as SpanLayout })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="tree">
                      <Text textStyle="xs">Tree</Text>
                    </Radio>
                    <Radio value="bullets">
                      <Text textStyle="xs">Bullets</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

/**
 * Inline span that renders a "thinking" run with a slow shimmer animation
 * sweeping across the text and a "Thinking" tooltip on hover. Lives at the
 * markdown component layer (driven by the `em` override) so it can use real
 * Chakra primitives rather than fighting Shiki's inline-styled spans.
 */
function ThinkingText({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip content="Thinking" positioning={{ placement: "top" }}>
      <Box
        as="em"
        display="inline"
        cursor="help"
        fontStyle="italic"
        backgroundImage={`linear-gradient(
          100deg,
          color-mix(in srgb, currentColor 38%, transparent) 0%,
          color-mix(in srgb, currentColor 38%, transparent) 38%,
          currentColor 50%,
          color-mix(in srgb, currentColor 38%, transparent) 62%,
          color-mix(in srgb, currentColor 38%, transparent) 100%
        )`}
        backgroundSize="220% 100%"
        backgroundRepeat="no-repeat"
        backgroundClip="text"
        WebkitBackgroundClip="text"
        color="transparent !important"
        animation={`${thinkingShimmer} 2.4s linear infinite`}
        css={{
          "& *": {
            color: "inherit !important",
            background: "inherit !important",
            backgroundClip: "inherit !important",
            WebkitBackgroundClip: "inherit !important",
          },
        }}
        // Reduced motion: kill the animation but keep the muted italic
        _reducedMotion={{
          animation: "none",
          backgroundImage: "none",
          color: "fg.muted !important",
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

const THINKING_MARKER_RE = /^🧠\s*/;

/**
 * If the first text node of a markdown `<em>` body starts with the 🧠
 * thinking marker, return the children with that prefix stripped. Returns
 * null when the marker is absent so the caller can fall back to plain em.
 */
function stripThinkingMarker(
  children: React.ReactNode,
): React.ReactNode | null {
  const arr = React.Children.toArray(children);
  const first = arr[0];
  if (typeof first !== "string") return null;
  if (!THINKING_MARKER_RE.test(first)) return null;
  const stripped = first.replace(THINKING_MARKER_RE, "");
  if (!stripped && arr.length === 1) return "";
  return [stripped, ...arr.slice(1)];
}

export function MarkdownCopyButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      size="xs"
      variant="outline"
      colorPalette="blue"
      onClick={handleCopy}
      paddingX={2}
      height="24px"
      gap={1}
    >
      <Icon as={copied ? LuCheck : LuCopy} boxSize={3} />
      <Text textStyle="2xs" fontWeight="semibold">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
  );
}

function useShikiAdapter(colorMode: string) {
  return useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        return createHighlighter({
          langs: [
            "markdown",
            "json",
            "bash",
            "typescript",
            "python",
            "xml",
            "html",
            "yaml",
          ],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);
}

/**
 * Markdown → Chakra components mapping. Each element is a real Chakra
 * component (`Heading`, `Text`, `Link`, `Table`, etc.) so typography,
 * spacing, and colors all flow from the theme — instead of being pinned by
 * raw CSS strings. Shiki keeps doing the syntax highlighting for fenced
 * code blocks; everything else is themable.
 */
function buildMarkdownComponents(colorMode: string) {
  return {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h1" size="md" marginTop={3} marginBottom={2}>
        {children}
      </Heading>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h2" size="xs" marginTop={4} marginBottom={1.5}>
        {children}
      </Heading>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h3" size="xs" marginTop={3} marginBottom={1}>
        {children}
      </Heading>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h4" size="xs" marginTop={2} marginBottom={1}>
        {children}
      </Heading>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <Text textStyle="xs" lineHeight="1.7" marginBottom={2}>
        {children}
      </Text>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <Box as="ul" paddingLeft={5} marginBottom={2} listStyleType="disc">
        {children}
      </Box>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <Box as="ol" paddingLeft={5} marginBottom={2}>
        {children}
      </Box>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <Box as="li" textStyle="xs" lineHeight="1.6" marginBottom={0.5}>
        {children}
      </Box>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <Box
        as="blockquote"
        borderLeftWidth="3px"
        borderLeftColor="border.emphasized"
        paddingLeft={3}
        paddingY={1}
        marginY={2}
        color="fg.muted"
        fontStyle="italic"
      >
        {children}
      </Box>
    ),
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
      <Link href={href} color="blue.fg" textDecoration="underline">
        {children}
      </Link>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <Text as="strong" fontWeight="semibold" display="inline">
        {children}
      </Text>
    ),
    em: ({ children }: { children?: React.ReactNode }) => {
      // Thinking blocks are emitted as `*🧠 …*` — detect the leading
      // marker, strip it, and render through the shimmery `ThinkingText`
      // component. The marker stays in the underlying markdown source so
      // copy-paste still preserves the "this was a thinking block" signal.
      const stripped = stripThinkingMarker(children);
      if (stripped) return <ThinkingText>{stripped}</ThinkingText>;
      return (
        <Text as="em" fontStyle="italic" display="inline">
          {children}
        </Text>
      );
    },
    del: ({ children }: { children?: React.ReactNode }) => (
      <Text as="del" textDecoration="line-through" color="fg.muted" display="inline">
        {children}
      </Text>
    ),
    hr: () => (
      <Box
        as="hr"
        borderTopWidth="1px"
        borderTopColor="border.muted"
        marginY={3}
      />
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <Box overflowX="auto" marginY={2}>
        <Table.Root size="sm" variant="line">
          {children}
        </Table.Root>
      </Box>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <Table.Header>{children}</Table.Header>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <Table.Body>{children}</Table.Body>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <Table.Row>{children}</Table.Row>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <Table.ColumnHeader>{children}</Table.ColumnHeader>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <Table.Cell>{children}</Table.Cell>
    ),
    code(props: {
      className?: string;
      children?: React.ReactNode;
      inline?: boolean;
    }) {
      const { className, children } = props;
      const match = /language-(\w+)/.exec(className ?? "");
      const lang = match ? match[1] : undefined;
      const code = String(children ?? "").replace(/\n$/, "");
      if (!lang) {
        // Inline code: themed mono chip.
        return (
          <Text
            as="code"
            fontFamily="mono"
            fontSize="0.85em"
            paddingX={1}
            paddingY="1px"
            borderRadius="xs"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.muted"
            display="inline"
          >
            {children}
          </Text>
        );
      }
      return (
        <ShikiCodeBlock code={code} language={lang} colorMode={colorMode} />
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
}

/**
 * Reusable rendered-markdown block. Maps markdown → Chakra components so
 * typography, spacing, colors, links, tables all inherit from the theme.
 * Shiki handles fenced code blocks. Wraps in a Shiki adapter provider so
 * callers don't have to.
 */
export function RenderedMarkdown({
  markdown,
  paddingX = 2,
  paddingY = 1.5,
}: {
  markdown: string;
  paddingX?: number;
  paddingY?: number;
}) {
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);
  const components = useMemo(
    () => buildMarkdownComponents(colorMode),
    [colorMode],
  );

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <Box paddingX={paddingX} paddingY={paddingY} color="fg">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </Box>
    </CodeBlock.AdapterProvider>
  );
}

export function MarkdownView({
  trace,
  spans,
  fullSpans,
  config,
}: MarkdownViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("source");
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);

  const markdown = useMemo(
    () => (trace ? buildTraceMarkdown(trace, spans, config, fullSpans) : ""),
    [trace, spans, config, fullSpans],
  );

  if (!trace) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No trace data
        </Text>
      </Flex>
    );
  }

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <Flex direction="column" height="full">
        <Box flex={1} overflow="auto" bg="bg.panel">
          {viewMode === "rendered" ? (
            <RenderedMarkdown markdown={markdown} />
          ) : (
            <ShikiCodeBlock
              code={markdown}
              language="markdown"
              colorMode={colorMode}
              flush
            />
          )}
        </Box>

        {/* Footer: view mode toggle */}
        <HStack
          paddingX={2}
          paddingY={1}
          gap={1}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
          flexShrink={0}
          justify="flex-end"
        >
          <SegmentedToggle
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            options={["source", "rendered"]}
          />
        </HStack>
      </Flex>
    </CodeBlock.AdapterProvider>
  );
}

/**
 * Lean Shiki renderer: calls `codeToHtml` directly and drops the result in
 * one mounting element. No `CodeBlock.Root → Content → Code → CodeText`
 * ladder, no outer "preview card" chrome. Shiki returns its own
 * `<pre><code>…</code></pre>` — we use `display: contents` on the mount
 * div so it hoists Shiki's `<pre>` to the parent's layout level.
 */
export function ShikiHighlight({
  code,
  language,
  colorMode,
}: {
  code: string;
  language: string;
  colorMode: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const theme = colorMode === "dark" ? "github-dark" : "github-light";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await codeToHtml(code, { lang: language, theme });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  // After Shiki mounts its HTML, walk the resulting DOM and decorate any
  // text node containing the 🧠 thinking marker. Doing this post-mount
  // (rather than via a regex on the HTML string) is robust: Shiki's
  // tokenisation can split emojis/punctuation across spans in ways a
  // regex can't reliably match, but a TreeWalker just finds the text and
  // tags its parent span regardless of how the tokens shake out.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (html == null) return;
    const root = containerRef.current;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes("🧠")) targets.push(node as Text);
    }
    for (const text of targets) {
      const parent = text.parentElement;
      if (!parent || parent.classList.contains("thinking-shimmer")) continue;
      parent.classList.add("thinking-shimmer");
      parent.setAttribute("title", "Thinking");
    }
    // Strip the marker glyph (and the following space) from rendered text
    // — keep the run intact in source but quiet it visually.
    for (const text of targets) {
      if (text.nodeValue) {
        text.nodeValue = text.nodeValue.replace(/🧠\s?/g, "");
      }
    }
  }, [html]);

  if (html == null) {
    // Pre-load fallback: plain mono text in a <pre>. Same character output
    // as Shiki produces, just without colour. No outer Box, no padding.
    return (
      <Box
        as="pre"
        margin={0}
        padding={0}
        bg="transparent"
        fontFamily="mono"
        fontSize="0.8em"
        lineHeight="1.55"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color="fg"
      >
        {code}
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
      display="contents"
      css={{
        "& > pre": {
          margin: 0,
          padding: 0,
          background: "transparent !important",
          fontFamily: "var(--chakra-fonts-mono)",
          fontSize: "0.8em",
          lineHeight: "1.55",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
        "& code": { fontFamily: "inherit" },
        "& .thinking-shimmer": {
          fontStyle: "italic",
          backgroundImage:
            "linear-gradient(100deg, currentColor 30%, rgba(255,255,255,0.7) 50%, currentColor 70%) !important",
          backgroundSize: "200% auto",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent !important",
          animation: `${thinkingShimmer} 3s linear infinite`,
          cursor: "help",
          "& *": {
            color: "inherit !important",
            background: "inherit !important",
            backgroundClip: "inherit !important",
            WebkitBackgroundClip: "inherit !important",
          },
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .thinking-shimmer": { animation: "none" },
        },
      }}
    />
  );
}

export function ShikiCodeBlock({
  code,
  language,
  colorMode,
  flush,
}: {
  code: string;
  language: string;
  colorMode: string;
  flush?: boolean;
}) {
  // Self-contained: wraps its own AdapterProvider so call sites don't need
  // to remember to set one up. Without this, Shiki silently no-ops and the
  // block renders unstyled mono text — which was the bug behind "syntax
  // highlighting isn't working anywhere."
  const shikiAdapter = useShikiAdapter(colorMode);
  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <ClientOnly
        fallback={
          <Box
            as="pre"
            textStyle="xs"
            fontFamily="mono"
            color="fg"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            lineHeight="1.6"
            padding={flush ? 4 : 2.5}
            borderRadius={flush ? 0 : "md"}
            borderWidth={flush ? 0 : "1px"}
            borderColor="border.muted"
            bg={flush ? "transparent" : "bg.subtle"}
            marginBottom={flush ? 0 : 2}
          >
            {code}
          </Box>
        }
      >
        {() => (
          <CodeBlock.Root
            size="sm"
            code={code}
            language={language}
            meta={{ colorScheme: colorMode }}
            borderRadius={flush ? 0 : "md"}
            borderWidth={flush ? 0 : "1px"}
            borderColor="border.muted"
            bg={flush ? "transparent" : "bg.subtle"}
            marginBottom={flush ? 0 : 1.5}
            overflow="hidden"
          >
            <CodeBlock.Content
              paddingX={flush ? 2 : 2}
              paddingY={flush ? 1.5 : 1.5}
              css={{
                "& pre, & code": {
                  background: "transparent !important",
                  fontSize: flush ? "0.8em" : "0.78em",
                  lineHeight: "1.55",
                  padding: "0 !important",
                  margin: "0 !important",
                },
              }}
            >
              <CodeBlock.Code>
                <CodeBlock.CodeText />
              </CodeBlock.Code>
            </CodeBlock.Content>
          </CodeBlock.Root>
        )}
      </ClientOnly>
    </CodeBlock.AdapterProvider>
  );
}
