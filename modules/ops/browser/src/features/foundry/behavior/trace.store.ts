import { create } from "zustand";

import type { SpanConfig, SpanType, TraceConfig } from "../model/foundry-types.ts";
import { shortId } from "../model/foundry-types.ts";

function createDefaultSpan(type: SpanType = "span", name?: string): SpanConfig {
  return {
    id: shortId(),
    name: name ?? type,
    type,
    durationMs: type === "llm" ? 500 : 100,
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    ...(type === "llm"
      ? {
          llm: {
            requestModel: "gpt-4o",
            messages: [
              { role: "user" as const, content: "Hello, how are you?" },
              {
                role: "assistant" as const,
                content: "I'm doing well, thank you for asking!",
              },
            ],
            temperature: 0.7,
            metrics: { promptTokens: 12, completionTokens: 15 },
          },
          input: {
            type: "chat_messages" as const,
            value: [{ role: "user", content: "Hello, how are you?" }],
          },
          output: {
            type: "text" as const,
            value: "I'm doing well, thank you for asking!",
          },
        }
      : {}),
    ...(type === "rag"
      ? {
          rag: {
            contexts: [
              {
                document_id: "doc-1",
                chunk_id: "chunk-1",
                content: "Example retrieved passage",
              },
            ],
          },
        }
      : {}),
  };
}

function createDefaultTrace(): TraceConfig {
  return {
    id: shortId(),
    name: "New Trace",
    resourceAttributes: { "service.name": "my-service" },
    metadata: {},
    spans: [createDefaultSpan("llm", "chat-completion")],
  };
}

interface TraceStore {
  trace: TraceConfig;
  selectedSpanId: string | null;
  // Property-typed rather than method shorthand: every one of these is read
  // out through a zustand selector (`useTraceStore((s) => s.setTrace)`),
  // which extracts it unbound. None reads `this` — the store closes over
  // `set` instead — so this is a pure lint fix, not a behavior change.
  setTrace: (trace: TraceConfig) => void;
  updateTrace: (partial: Partial<TraceConfig>) => void;
  selectSpan: (id: string | null) => void;
  addSpan: (parentId: string | null, type: SpanType) => void;
  removeSpan: (id: string) => void;
  updateSpan: (id: string, partial: Partial<SpanConfig>) => void;
  moveSpan: (id: string, direction: "up" | "down") => void;
  indentSpan: (id: string) => void;
  outdentSpan: (id: string) => void;
  duplicateSpan: (id: string) => void;
  resetTrace: () => void;
}

function updateSpanInTree(
  spans: SpanConfig[],
  id: string,
  updater: (span: SpanConfig) => SpanConfig,
): SpanConfig[] {
  return spans.map((span) => {
    if (span.id === id) return updater(span);
    if (span.children.length > 0) {
      return {
        ...span,
        children: updateSpanInTree(span.children, id, updater),
      };
    }
    return span;
  });
}

function removeSpanFromTree(spans: SpanConfig[], id: string): SpanConfig[] {
  return spans
    .filter((span) => span.id !== id)
    .map((span) => ({
      ...span,
      children: removeSpanFromTree(span.children, id),
    }));
}

function addSpanToTree(
  spans: SpanConfig[],
  parentId: string | null,
  newSpan: SpanConfig,
): SpanConfig[] {
  if (parentId === null) return [...spans, newSpan];
  return spans.map((span) => {
    if (span.id === parentId) {
      return { ...span, children: [...span.children, newSpan] };
    }
    return {
      ...span,
      children: addSpanToTree(span.children, parentId, newSpan),
    };
  });
}

function findSpanParent(
  spans: SpanConfig[],
  id: string,
  parent: SpanConfig | null = null,
): { parent: SpanConfig | null; siblings: SpanConfig[]; index: number } | null {
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]!.id === id) {
      return { parent, siblings: spans, index: i };
    }
    const found = findSpanParent(spans[i]!.children, id, spans[i]!);
    if (found) return found;
  }
  return null;
}

/** An in-place edit on a clone of the spans; the state stays as it was when the edit declines. */
function withEditedSpans(state: TraceStore, edit: (spans: SpanConfig[]) => boolean) {
  const spans = structuredClone(state.trace.spans);
  return edit(spans) ? { trace: { ...state.trace, spans } } : state;
}

function moveAmongSiblings({
  spans,
  id,
  direction,
}: {
  spans: SpanConfig[];
  id: string;
  direction: Parameters<TraceStore["moveSpan"]>[1];
}): boolean {
  const found = findSpanParent(spans, id);
  if (!found) return false;
  const { siblings, index } = found;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return false;
  [siblings[index], siblings[targetIndex]] = [siblings[targetIndex]!, siblings[index]!];
  return true;
}

function indentUnderPreviousSibling(spans: SpanConfig[], id: string): boolean {
  const found = findSpanParent(spans, id);
  if (!found || found.index === 0) return false;
  const span = found.siblings.splice(found.index, 1)[0]!;
  found.siblings[found.index - 1]!.children.push(span);
  return true;
}

function outdentBesideParent(spans: SpanConfig[], id: string): boolean {
  const found = findSpanParent(spans, id);
  if (!found?.parent) return false;
  const span = found.siblings.splice(found.index, 1)[0]!;
  const parentFound = findSpanParent(spans, found.parent.id);
  if (!parentFound) return false;
  parentFound.siblings.splice(parentFound.index + 1, 0, span);
  return true;
}

function reassignIds(span: SpanConfig): void {
  span.id = shortId();
  span.children.forEach(reassignIds);
}

/** Inserts a fresh-id copy right after the span, answering the copy's id, or null when absent. */
function insertDuplicate(spans: SpanConfig[], id: string): string | null {
  const found = findSpanParent(spans, id);
  if (!found) return null;
  const original = found.siblings[found.index]!;
  const duplicate = structuredClone(original);
  reassignIds(duplicate);
  duplicate.name = `${original.name} (copy)`;
  found.siblings.splice(found.index + 1, 0, duplicate);
  return duplicate.id;
}

export const useTraceStore = create<TraceStore>((set) => ({
  trace: createDefaultTrace(),
  selectedSpanId: null,

  setTrace(trace) {
    set({ trace, selectedSpanId: null });
  },

  updateTrace(partial) {
    set((state) => ({ trace: { ...state.trace, ...partial } }));
  },

  selectSpan(id) {
    set({ selectedSpanId: id });
  },

  addSpan(parentId, type) {
    const newSpan = createDefaultSpan(type);
    set((state) => ({
      trace: {
        ...state.trace,
        spans: addSpanToTree(state.trace.spans, parentId, newSpan),
      },
      selectedSpanId: newSpan.id,
    }));
  },

  removeSpan(id) {
    set((state) => ({
      trace: {
        ...state.trace,
        spans: removeSpanFromTree(state.trace.spans, id),
      },
      selectedSpanId: state.selectedSpanId === id ? null : state.selectedSpanId,
    }));
  },

  updateSpan(id, partial) {
    set((state) => ({
      trace: {
        ...state.trace,
        spans: updateSpanInTree(state.trace.spans, id, (span) => ({
          ...span,
          ...partial,
        })),
      },
    }));
  },

  moveSpan(id, direction) {
    set((state) => withEditedSpans(state, (spans) => moveAmongSiblings({ spans, id, direction })));
  },

  indentSpan(id) {
    set((state) => withEditedSpans(state, (spans) => indentUnderPreviousSibling(spans, id)));
  },

  outdentSpan(id) {
    set((state) => withEditedSpans(state, (spans) => outdentBesideParent(spans, id)));
  },

  duplicateSpan(id) {
    set((state) => {
      const spans = structuredClone(state.trace.spans);
      const duplicateId = insertDuplicate(spans, id);
      if (duplicateId === null) return state;
      return { trace: { ...state.trace, spans }, selectedSpanId: duplicateId };
    });
  },

  resetTrace() {
    set({ trace: createDefaultTrace(), selectedSpanId: null });
  },
}));

export { createDefaultSpan, createDefaultTrace };
