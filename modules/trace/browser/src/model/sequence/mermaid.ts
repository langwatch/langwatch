import { formatDuration } from "@langwatch/trace-browser-kit";
import type { SpanTreeNode } from "@langwatch/trace-contract";

import { buildSpanTree, type SpanWithChildren, sanitiseMermaidId } from "./mermaid-shared.ts";
import type { SequenceSpanType } from "./types.ts";

export const INVISIBLE_RETURN = "\u200B";

export type ParticipantKind = "agent" | "llm" | "tool" | "other";

export interface SequenceMermaidResult {
  syntax: string;
  /** Sanitised participant id → first matching span id, for click → select. */
  participantToSpanId: Map<string, string>;
  /** Sanitised participant id → display label rendered by Mermaid. */
  participantDisplay: Map<string, string>;
  /** Sanitised participant id → kind, used for CSS post-processing. */
  participantKind: Map<string, ParticipantKind>;
  /** Total messages emitted (used for "diagram trimmed" UI hints). */
  messageCount: number;
  /** Stable participant order (used for empty-state checks). */
  participants: string[];
}

const MAX_MESSAGES = 400;

function getParticipantId(span: SpanTreeNode): string | null {
  if (span.type === "agent" && span.name) {
    return sanitiseMermaidId(
      span.name.replace(".call", "").replace(".run", "").replace("invoke_agent ", ""),
    );
  }
  if (span.type === "llm" && span.model) {
    return sanitiseMermaidId(span.model);
  }
  if (span.type === "tool") return null;
  return span.name ? sanitiseMermaidId(span.name) : null;
}

function getParticipantDisplay(span: SpanTreeNode): string | null {
  if (span.type === "agent" && span.name) {
    return span.name.replace(".call", "").replace(".run", "").replace("invoke_agent ", "");
  }
  if (span.type === "llm" && span.model) {
    return span.model;
  }
  if (span.type === "tool") return null;
  return span.name ?? null;
}

function escapeLabel(text: string): string {
  // Mermaid sequence labels treat `:` as the label separator and `;` as a
  // statement terminator; `<`/`>` would be interpreted as HTML and `#` starts a
  // comment. Strip anything Mermaid might choke on, and cap length.
  const sanitised = text.replace(/[#;]/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (sanitised.length <= 60) return sanitised;
  return `${sanitised.slice(0, 57)}…`;
}

interface BuildContext {
  typesToInclude: ReadonlySet<string>;
  messages: string[];
  participants: Set<string>;
  participantDisplay: Map<string, string>;
  participantTypes: Map<string, string>;
  participantToSpanId: Map<string, string>;
  processed: Set<string>;
}

function registerParticipant(ctx: BuildContext, span: SpanTreeNode, id: string, display: string) {
  if (!ctx.participants.has(id)) {
    ctx.participants.add(id);
    ctx.participantDisplay.set(id, display);
    ctx.participantTypes.set(id, span.type ?? "span");
    ctx.participantToSpanId.set(id, span.spanId);
  }
}

function findIncludedDescendants(
  span: SpanWithChildren,
  typesToInclude: ReadonlySet<string>,
): SpanWithChildren[] {
  const out: SpanWithChildren[] = [];
  const walk = (node: SpanWithChildren) => {
    if (typesToInclude.has(node.type ?? "span")) {
      out.push(node);
    } else {
      for (const child of node.children) walk(child);
    }
  };
  for (const child of span.children) walk(child);
  return out;
}

function processExcludedSpan(
  span: SpanWithChildren,
  ctx: BuildContext,
  parentParticipant: string | null,
): void {
  const descendants = findIncludedDescendants(span, ctx.typesToInclude);
  descendants
    .slice()
    .toSorted((a, b) => a.startTimeMs - b.startTimeMs)
    .forEach((descendant) => processSpan(descendant, ctx, parentParticipant));
}

function processToolSpan({
  span,
  ctx,
  parentParticipant,
  duration,
  isError,
}: {
  span: SpanWithChildren;
  ctx: BuildContext;
  parentParticipant: string | null;
  duration: number;
  isError: boolean;
}): boolean {
  if (span.type !== "tool") return false;
  if (!parentParticipant) return false;
  if (!span.name) return false;

  const label = escapeLabel(
    `tool: ${span.name} · ${formatDuration(duration)}${isError ? " · error" : ""}`,
  );
  if (isError) ctx.messages.push("    rect rgba(248, 113, 113, 0.12)");
  ctx.messages.push(`    ${parentParticipant}->>${parentParticipant}: ${label}`);
  if (isError) ctx.messages.push("    end");
  span.children
    .slice()
    .toSorted((a, b) => a.startTimeMs - b.startTimeMs)
    .forEach((child) => processSpan(child, ctx, parentParticipant));
  return true;
}

function interactionLabel({
  span,
  type,
  duration,
  parentType,
}: {
  span: SpanWithChildren;
  type: string;
  duration: number;
  parentType: string | undefined;
}): string {
  if (type === "llm") return `LLM call · ${formatDuration(duration)}`;
  if (type === "agent") {
    const verb = parentType === "agent" ? "handover" : "call";
    return `${verb} · ${formatDuration(duration)}`;
  }

  const head = (span.name ?? type).slice(0, 40);
  return `${head} · ${formatDuration(duration)}`;
}

function emitInteractionStart({
  span,
  ctx,
  type,
  duration,
  isError,
  currentParticipant,
  parentParticipant,
}: {
  span: SpanWithChildren;
  ctx: BuildContext;
  type: string;
  duration: number;
  isError: boolean;
  currentParticipant: string;
  parentParticipant: string;
}): void {
  let label = interactionLabel({
    span,
    type,
    duration,
    parentType: ctx.participantTypes.get(parentParticipant),
  });
  if (isError) label += " · error";

  if (isError) ctx.messages.push("    rect rgba(248, 113, 113, 0.12)");
  ctx.messages.push(`    ${parentParticipant}->>${currentParticipant}: ${escapeLabel(label)}`);
  ctx.messages.push(`    activate ${currentParticipant}`);
}

function emitInteractionEnd({
  ctx,
  isError,
  currentParticipant,
  parentParticipant,
}: {
  ctx: BuildContext;
  isError: boolean;
  currentParticipant: string;
  parentParticipant: string;
}): void {
  ctx.messages.push(`    ${currentParticipant}-->>${parentParticipant}: ${INVISIBLE_RETURN}`);
  ctx.messages.push(`    deactivate ${currentParticipant}`);
  if (isError) ctx.messages.push("    end");
}

function processSpan(span: SpanWithChildren, ctx: BuildContext, parentParticipant: string | null) {
  if (ctx.processed.has(span.spanId)) return;
  ctx.processed.add(span.spanId);
  if (ctx.messages.length >= MAX_MESSAGES) return;

  const type = span.type ?? "span";
  const isIncluded = ctx.typesToInclude.has(type);
  const duration = Math.max(0, span.endTimeMs - span.startTimeMs);
  const isError = span.status === "error";

  if (!isIncluded) {
    processExcludedSpan(span, ctx, parentParticipant);
    return;
  }

  if (processToolSpan({ span, ctx, parentParticipant, duration, isError })) return;

  const id = getParticipantId(span);
  const display = getParticipantDisplay(span);
  const currentParticipant = id && display ? id : null;
  if (currentParticipant && display) {
    registerParticipant(ctx, span, currentParticipant, display);
  }

  const isInteraction =
    !!currentParticipant && !!parentParticipant && currentParticipant !== parentParticipant;

  if (isInteraction) {
    emitInteractionStart({
      span,
      ctx,
      type,
      duration,
      isError,
      currentParticipant,
      parentParticipant,
    });
  }

  const nextParent = currentParticipant ?? parentParticipant;
  span.children
    .slice()
    .toSorted((a, b) => a.startTimeMs - b.startTimeMs)
    .forEach((child) => processSpan(child, ctx, nextParent));

  if (isInteraction) {
    emitInteractionEnd({ ctx, isError, currentParticipant, parentParticipant });
  }
}

function processRoots({
  roots,
  tree,
  ctx,
}: {
  roots: SpanTreeNode[];
  tree: Record<string, SpanWithChildren>;
  ctx: BuildContext;
}): void {
  for (const root of roots) {
    const node = tree[root.spanId];
    if (node) processSpan(node, ctx, null);
  }
}

function buildParticipantKindMap(ctx: BuildContext): Map<string, ParticipantKind> {
  const kindByParticipant = new Map<string, ParticipantKind>();
  for (const id of ctx.participants) {
    const type = ctx.participantTypes.get(id);
    if (type === "agent") kindByParticipant.set(id, "agent");
    else if (type === "llm") kindByParticipant.set(id, "llm");
    else if (type === "tool") kindByParticipant.set(id, "tool");
    else kindByParticipant.set(id, "other");
  }

  return kindByParticipant;
}

export function generateMermaidSyntax(
  spans: SpanTreeNode[],
  includedTypes: readonly SequenceSpanType[],
): SequenceMermaidResult {
  const tree = buildSpanTree(spans);
  const typesToInclude = new Set<string>(includedTypes);

  const ctx: BuildContext = {
    typesToInclude,
    messages: [],
    participants: new Set(),
    participantDisplay: new Map(),
    participantTypes: new Map(),
    participantToSpanId: new Map(),
    processed: new Set(),
  };

  // Pre-register participants from all included spans so the diagram lays them
  // out in the order they first appear chronologically.
  const ordered = spans
    .filter((s) => typesToInclude.has(s.type ?? "span"))
    .slice()
    .toSorted((a, b) => a.startTimeMs - b.startTimeMs);
  for (const span of ordered) {
    const id = getParticipantId(span);
    const display = getParticipantDisplay(span);
    if (id && display) registerParticipant(ctx, span, id, display);
  }

  const spanById = new Map(spans.map((s) => [s.spanId, s]));
  const roots = spans
    .filter((s) => !s.parentSpanId || !spanById.has(s.parentSpanId))
    .slice()
    .toSorted((a, b) => a.startTimeMs - b.startTimeMs);

  processRoots({ roots, tree, ctx });

  // Agents render as stick-figure `actor`s; everything else as labelled
  // `participant` boxes. The stick figure visually tags humanish/agentic
  // roles in the diagram. Per-kind colouring is layered on top via CSS.
  let syntax = "sequenceDiagram\n";
  for (const id of ctx.participants) {
    const display = ctx.participantDisplay.get(id) ?? id;
    const type = ctx.participantTypes.get(id);
    const keyword = type === "agent" ? "actor" : "participant";
    syntax += `    ${keyword} ${id} as ${escapeLabel(display)}\n`;
  }
  for (const message of ctx.messages) syntax += `${message}\n`;

  if (ctx.messages.length >= MAX_MESSAGES) {
    syntax += `    Note over ${
      Array.from(ctx.participants)[0] ?? "trace"
    }: diagram truncated at ${MAX_MESSAGES} messages\n`;
  }

  const participantKind = buildParticipantKindMap(ctx);

  return {
    syntax,
    participantToSpanId: ctx.participantToSpanId,
    participantDisplay: ctx.participantDisplay,
    participantKind,
    messageCount: ctx.messages.length,
    participants: Array.from(ctx.participants),
  };
}
