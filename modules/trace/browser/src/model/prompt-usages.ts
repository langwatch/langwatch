// The prompts a trace ran, grouped from its spans' prompt references.
// A prompt that ran in a span braided from another project is that project's (ADR-183 §5).

import type { SpanDetail } from "@langwatch/trace-contract";

import {
  extractPromptReference,
  type PromptReference,
  promptReferenceKey,
} from "./prompt-attributes.ts";

export interface PromptUsage {
  ref: PromptReference;
  /** Span IDs that referenced this prompt. */
  spanIds: string[];
  /** Variable values (latest seen per key, since spans may share vars). */
  variables: Record<string, string>;
  /** The project a braided span's prompt belongs to; absent for the reader's own prompts. */
  ownerName?: string;
}

/** The span fields the panel groups by. */
export type PromptSpan = Pick<SpanDetail, "spanId" | "params" | "braid">;

/** The usage a span's prompt joins, made on first sight; another project's prompt is its own. */
function usageFor({
  ref,
  braid,
  byKey,
  byHandle,
}: {
  ref: PromptReference;
  braid: PromptSpan["braid"];
  byKey: Map<string, PromptUsage>;
  byHandle: Map<string, PromptUsage[]>;
}): PromptUsage {
  const key = braid
    ? JSON.stringify([braid.ownerProjectId, promptReferenceKey(ref)])
    : promptReferenceKey(ref);
  const known = byKey.get(key);
  if (known) return known;
  const usage: PromptUsage = {
    ref,
    spanIds: [],
    variables: {},
    ...(braid ? { ownerName: braid.ownerName } : {}),
  };
  byKey.set(key, usage);
  // Only the reader's own prompts answer a trace-level reference by handle.
  if (!braid) byHandle.set(ref.handle, [...(byHandle.get(ref.handle) ?? []), usage]);
  return usage;
}

function indexPromptUsages(spansFull: readonly PromptSpan[]): {
  byKey: Map<string, PromptUsage>;
  byHandle: Map<string, PromptUsage[]>;
} {
  const byKey = new Map<string, PromptUsage>();
  const byHandle = new Map<string, PromptUsage[]>();

  for (const span of spansFull) {
    const ref = extractPromptReference(span.params);
    if (!ref) continue;
    const usage = usageFor({ ref, braid: span.braid, byKey, byHandle });
    usage.spanIds.push(span.spanId);
    Object.assign(usage.variables, ref.variables ?? {});
    if (ref.draft && !usage.ref.draft) {
      usage.ref = { ...usage.ref, draft: true };
    }
  }

  return { byKey, byHandle };
}

function orderPromptUsages({
  fallbackRefs,
  byKey,
  byHandle,
}: {
  fallbackRefs: PromptReference[];
  byKey: Map<string, PromptUsage>;
  byHandle: Map<string, PromptUsage[]>;
}): PromptUsage[] {
  const ordered: PromptUsage[] = [];
  const seen = new Set<string>();

  for (const ref of fallbackRefs) {
    const key = promptReferenceKey(ref);
    const exact = byKey.get(key);
    if (exact) {
      ordered.push(exact);
      seen.add(key);
      continue;
    }

    if (ref.versionNumber == null && !ref.tag) {
      const candidates = byHandle.get(ref.handle);
      if (candidates && candidates.length > 0) {
        const usage = candidates[0]!;
        ordered.push(usage);
        seen.add(promptReferenceKey(usage.ref));
        continue;
      }
    }

    ordered.push({ ref, spanIds: [], variables: {} });
    seen.add(key);
  }

  for (const [key, usage] of byKey) {
    if (!seen.has(key)) ordered.push(usage);
  }
  return ordered;
}

/**
 * Aggregates spans by their prompt reference. Falls back to the trace-level
 * `langwatch.prompt_ids` summary when full span data hasn't loaded yet so the panel
 * always shows *which* prompts ran, even before variables stream in.
 */
export function aggregatePromptUsage(
  spansFull: readonly PromptSpan[] | undefined,
  fallbackRefs: PromptReference[],
): PromptUsage[] {
  if (!spansFull || spansFull.length === 0) {
    return fallbackRefs.map((ref) => ({ ref, spanIds: [], variables: {} }));
  }

  // Index span-derived usages by handle alone too, so a fallback ref with
  // no version (e.g. `"handle:latest"` from `langwatch.prompt_ids`) can
  // still match against spans on that handle even when version numbers
  // differ. Without this, the panel rendered every fallback card with
  // empty span lists and a bogus "still loading" message.
  const index = indexPromptUsages(spansFull);
  return orderPromptUsages({ fallbackRefs, ...index });
}
