import type { LegacySpanInputOutput, Span } from "@langwatch/trace-contract";
import type {
  ConversationStep,
  ConversationStepKind,
  ConversationStepUsage,
} from "@langwatch/trace-contract/conversation";
import { type ChatMessage, parseContentBlocks } from "@langwatch/trace-contract/transcript";

import { extractLlmMessagesForSpan } from "./trace-llm-messages.rules.ts";

/** What a span is to a turn: one of its steps, or nothing worth a line. */
type SpanRole = ConversationStepKind | "not-a-step";

interface StepContext {
  byId: Map<string, Span>;
  parentIds: Set<string>;
  printedProse: Set<string>;
}

/**
 * A trace's spans as the steps of one turn: model calls with token counts,
 * tool calls with arguments and results, retrievals, and spans nested in a
 * tool call. @see specs/traces/trace-extraction-modules.feature
 */
export function extractConversationSteps({
  spans,
  replyText,
}: {
  spans: readonly Span[];
  /** The turn's reply, which a model call's prose is not repeated beside. */
  replyText: string;
}): ConversationStep[] {
  const context: StepContext = {
    byId: new Map(spans.map((span) => [span.span_id, span])),
    parentIds: new Set(spans.flatMap((span) => (span.parent_id ? [span.parent_id] : []))),
    printedProse: new Set<string>([normalise(replyText)]),
  };
  const steps = spans
    .toSorted((a, b) => a.timestamps.started_at - b.timestamps.started_at)
    .flatMap((span) => findStepsOfSpan({ span, context }));
  return isOnlyTheReply(steps) ? [] : steps;
}

/** The step one span contributes, none when it is a container or repeats its parent. */
function findStepsOfSpan({
  span,
  context,
}: {
  span: Span;
  context: StepContext;
}): ConversationStep[] {
  const role = spanRole({ span, isLeaf: !context.parentIds.has(span.span_id) });
  if (role === "not-a-step") return [];
  const parent = span.parent_id ? context.byId.get(span.parent_id) : undefined;
  if (parent && repeatsParent({ span, parent })) return [];
  const depth = isInsideTool({ span, byId: context.byId }) ? 1 : 0;
  return [
    role === "model"
      ? modelStep({ span, depth, printedProse: context.printedProse })
      : ioStep({ span, kind: role, depth }),
  ];
}

/** A turn whose one step is the model call that wrote the reply, uncounted, adds nothing. */
function isOnlyTheReply(steps: readonly ConversationStep[]): boolean {
  const [only] = steps;
  return (
    steps.length === 1 &&
    only!.kind === "model" &&
    !only!.output &&
    (only!.calls ?? []).length === 0 &&
    !only!.usage &&
    !only!.error
  );
}

const CONTAINER_TYPES = new Set(["agent", "chain", "workflow", "task", "server", "client"]);

function spanRole({ span, isLeaf }: { span: Span; isLeaf: boolean }): SpanRole {
  if (span.type === "llm") return "model";
  if (span.type === "tool" || findToolNames(span).length > 0) return "tool";
  if (span.type === "rag") return "retrieval";
  if (!span.parent_id || CONTAINER_TYPES.has(span.type)) return "not-a-step";
  if (!span.input && !span.output) return "not-a-step";
  return isLeaf ? "span" : "not-a-step";
}

/** The tool's own name, from the attributes tool instrumentations record it under. */
function findToolNames(span: Span): string[] {
  const params = span.params ?? {};
  const nested = (params.gen_ai as { tool?: { name?: unknown } } | undefined)?.tool?.name;
  return [params["gen_ai.tool.name"], params.tool_name, nested].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
}

/** A child that only restates its parent's input and output, as a tool's execution phase does. */
function repeatsParent({ span, parent }: { span: Span; parent: Span }): boolean {
  if (!span.input && !span.output) return spanRole({ span, isLeaf: true }) === "tool";
  return (
    ioText(span.input) === ioText(parent.input) && ioText(span.output) === ioText(parent.output)
  );
}

function isInsideTool({ span, byId }: { span: Span; byId: Map<string, Span> }): boolean {
  let parentId = span.parent_id;
  for (let hops = 0; parentId && hops < 64; hops++) {
    const parent = byId.get(parentId);
    if (!parent) return false;
    if (parent.type === "tool" || findToolNames(parent).length > 0) return true;
    parentId = parent.parent_id;
  }
  return false;
}

function modelStep({
  span,
  depth,
  printedProse,
}: {
  span: Span;
  depth: number;
  printedProse: Set<string>;
}): ConversationStep {
  const { prose, calls } = modelOutputOf(span);
  const key = normalise(prose);
  const isNew = key !== "" && !printedProse.has(key);
  if (isNew) printedProse.add(key);
  const usage = usageOf(span);
  return {
    kind: "model",
    startedAt: span.timestamps.started_at,
    name: ("model" in span && span.model) || span.name || "model",
    depth,
    ...(isNew ? { output: prose } : {}),
    ...(calls.length > 0 ? { calls } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
    ...(span.error?.message ? { error: span.error.message } : {}),
  };
}

function ioStep({
  span,
  kind,
  depth,
}: {
  span: Span;
  kind: ConversationStepKind;
  depth: number;
}): ConversationStep {
  const input = ioText(span.input);
  const contexts = "contexts" in span && span.contexts ? JSON.stringify(span.contexts) : "";
  const output = kind === "retrieval" && contexts ? contexts : ioText(span.output);
  return {
    kind,
    startedAt: span.timestamps.started_at,
    name: findToolNames(span)[0] ?? span.name ?? kind,
    depth,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(span.error?.message ? { error: span.error.message } : {}),
  };
}

/** Claude Code writes the tool it called into its text output as `[tool_use: Name]`. */
const TEXT_TOOL_USE = /\[tool_use: ([^\]]+)\]/g;

/** A model call's prose and the tools it asked for, from whichever shape it recorded. */
function modelOutputOf(span: Span): { prose: string; calls: string[] } {
  const raw = ioText(span.output);
  if (raw.includes("[tool_use: ")) {
    const calls = [...raw.matchAll(TEXT_TOOL_USE)].map((match) => match[1]!);
    return { prose: raw.split("[tool_use: ")[0]!.trim(), calls };
  }
  const messages = extractLlmMessagesForSpan({ span }).output;
  return {
    prose: messages.map(textOf).filter(Boolean).join("\n").trim(),
    calls: messages.flatMap(toolCallsOf),
  };
}

function textOf(message: ChatMessage): string {
  if (message.role !== "assistant") return "";
  return parseContentBlocks(message.content)
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n");
}

function toolCallsOf(message: ChatMessage): string[] {
  const fromCalls = (message.tool_calls ?? []).map((call) => call.function?.name ?? "");
  const fromBlocks = parseContentBlocks(message.content).flatMap((block) =>
    block.kind === "tool_use" ? [block.name] : [],
  );
  return [...fromCalls, ...fromBlocks].filter((name) => name !== "");
}

/**
 * The token counts a model call reported; empty when it reported none. The
 * span's own usage attributes fill what the metrics lack: ingestion lifts
 * only non-zero counts, and a zero cache read is exactly what a reader asks about.
 */
function usageOf(span: Span): ConversationStepUsage {
  const metrics = span.metrics ?? {};
  const params = span.params ?? {};
  const usage: ConversationStepUsage = {};
  const pick = (fromMetrics: unknown, paths: readonly string[]) =>
    typeof fromMetrics === "number"
      ? fromMetrics
      : paths.flatMap((path) => findNumbersAt({ params, path }))[0];
  const input = pick(metrics.prompt_tokens, ["gen_ai.usage.input_tokens", "input_tokens"]);
  const cacheRead = pick(metrics.cache_read_input_tokens, [
    "gen_ai.usage.cache_read.input_tokens",
    "cache_read_tokens",
  ]);
  const cacheWrite = pick(metrics.cache_creation_input_tokens, [
    "gen_ai.usage.cache_creation.input_tokens",
    "cache_creation_tokens",
  ]);
  const output = pick(metrics.completion_tokens, ["gen_ai.usage.output_tokens", "output_tokens"]);
  if (input !== undefined) usage.input = input;
  if (cacheRead !== undefined) usage.cacheRead = cacheRead;
  if (cacheWrite !== undefined) usage.cacheWrite = cacheWrite;
  if (output !== undefined) usage.output = output;
  return usage;
}

/** The number at a dotted path, read flat first and then nested, as span params hold either. */
function findNumbersAt({
  params,
  path,
}: {
  params: Record<string, unknown>;
  path: string;
}): number[] {
  const flat = params[path];
  if (typeof flat === "number") return [flat];
  let node: unknown = params;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return [];
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "number" ? [node] : [];
}

function ioText(io: LegacySpanInputOutput | null | undefined): string {
  if (!io) return "";
  const value: unknown = io.value;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();
