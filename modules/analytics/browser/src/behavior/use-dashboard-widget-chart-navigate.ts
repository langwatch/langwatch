/**
 * Resolves an `LW.navigate(target, params)` call from a sandboxed, semi-trusted chart frame
 * into a real page navigation. `projectId` always comes from host context, never the frame's
 * params, so a widget cannot navigate into a different project's traces.
 */

import {
  NAVIGABLE_TARGETS,
  type NavigableTarget,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import { Temporal } from "@langwatch/time";
import { escapeValue, SEARCH_FIELDS } from "@langwatch/trace-contract";
import { useCallback } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";

/** The Explorer's default lens — the one an unfiltered explorer opens on. */
const TRACE_EXPLORER_LENS = "all-traces";

const KNOWN_LIQE_FIELDS = new Set(Object.keys(SEARCH_FIELDS));

/**
 * Legacy registry field id -> liqe field name (`SEARCH_FIELDS` keys), for ids with a confirmed
 * liqe counterpart. Deliberately NOT exhaustive: fields with no equivalent (KV search,
 * `traces.error`, `events.*`) are left unmapped so they warn-and-drop, not guess wrong.
 */
const FIELD_ID_TO_LIQE_FIELD: Readonly<Record<string, string>> = {
  "metadata.user_id": "user",
  "metadata.thread_id": "conversation",
  "metadata.customer_id": "customer",
  "metadata.labels": "label",
  "metadata.prompt_ids": "prompt",
  "traces.origin": "origin",
  "traces.name": "traceName",
  "spans.model": "model",
  "spans.type": "spanType",
  "annotations.hasAnnotation": "annotation",
  "topics.topics": "topic",
  "topics.subtopics": "subtopic",
  "evaluations.evaluator_id": "evaluator",
  "evaluations.state": "evaluatorStatus",
  "evaluations.passed": "evaluatorVerdict",
  "evaluations.score": "evaluatorScore",
  "evaluations.label": "evaluatorLabel",
};

/**
 * Maps an author-supplied filter key (legacy registry field id, or a bare
 * liqe field name) to the liqe field name traces-v2's query language reads.
 */
function resolveLiqeField(key: string): string | undefined {
  const mapped = FIELD_ID_TO_LIQE_FIELD[key];
  if (mapped) return mapped;
  if (KNOWN_LIQE_FIELDS.has(key)) return key;
  return undefined;
}

/** One liqe clause for a field, OR-ing multiple values in parens. */
function buildClause({ field, value }: { field: string; value: string | string[] }): string | null {
  const values = (Array.isArray(value) ? value : [value]).filter((v) => v !== "");
  if (values.length === 0) return null;
  if (values.length === 1) return `${field}:${escapeValue(values[0]!)}`;
  return `(${values.map((v) => `${field}:${escapeValue(v)}`).join(" OR ")})`;
}

/**
 * Builds the liqe `q` expression from author params, dropping `projectId`, `startDate`/`endDate`
 * (handled separately), and anything unresolvable to a known liqe field (warn-and-drop).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent rules.
function buildLiqeQuery(params: Readonly<Record<string, unknown>>): string {
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "projectId" || key === "startDate" || key === "endDate") {
      continue;
    }

    const field = resolveLiqeField(key);
    if (!field) {
      console.warn("[playground] dropped unmapped filter key: " + key);
      continue;
    }

    if (
      typeof value !== "string" &&
      !(Array.isArray(value) && value.every((v) => typeof v === "string"))
    ) {
      console.warn("[playground] dropped non-string filter value: " + key);
      continue;
    }

    const clause = buildClause({ field, value: value as string | string[] });
    if (clause) clauses.push(clause);
  }
  return clauses.join(" AND ");
}

function readEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    try {
      return Temporal.Instant.from(value).epochMilliseconds;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Builds the traces-v2 fragment (`<lensId>?q=&from=&to=`) for the given
 * author params — mirrors `traceExplorerLink.ts`'s `explorerFragment`.
 */
function buildTracesFragment(params: Readonly<Record<string, unknown>>): string {
  const fragmentParams = new URLSearchParams();

  const q = buildLiqeQuery(params);
  if (q) fragmentParams.set("q", q);

  const from = readEpochMs(params.startDate);
  const to = readEpochMs(params.endDate);
  if (from !== undefined && to !== undefined) {
    fragmentParams.set("from", String(from));
    fragmentParams.set("to", String(to));
  } else if (params.startDate !== undefined || params.endDate !== undefined) {
    // A bound was named but the pair did not resolve -- branch on parsed values, not key
    // presence, since a present-but-malformed bound would slip past a key-presence XOR silently.
    // Carrying a lone bound would misrepresent the window (see `traceExplorerLink.ts`), so
    // warn-and-drop and let the Explorer's own default window stand.
    console.warn(
      "[playground] dropped time range: startDate and endDate must both be set to a readable epoch-ms or date string",
    );
  }

  const fragmentQuery = fragmentParams.toString();
  return fragmentQuery ? `${TRACE_EXPLORER_LENS}?${fragmentQuery}` : TRACE_EXPLORER_LENS;
}

function isNavigableTarget(target: string): target is NavigableTarget {
  return (NAVIGABLE_TARGETS as readonly string[]).includes(target);
}

export function useDashboardWidgetChartNavigate(
  projectSlug: string,
): (args: { target: string; params: Readonly<Record<string, unknown>> }) => void {
  const host = useAnalyticsHost();

  return useCallback(
    ({ target, params }: { target: string; params: Readonly<Record<string, unknown>> }) => {
      if (!isNavigableTarget(target)) {
        console.warn("[playground] blocked navigate target: " + target);
        return;
      }

      if (target === "trace") {
        const traceId = params.traceId;
        if (typeof traceId !== "string" || !traceId) return;
        host.navigate(`/${projectSlug}/traces/${encodeURIComponent(traceId)}`);
        return;
      }

      // target === "traces"
      const fragment = buildTracesFragment(params);
      host.navigate(`/${projectSlug}/traces#${fragment}`);
    },
    [host, projectSlug],
  );
}
