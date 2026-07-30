import { formatMilliseconds } from "~/utils/formatMilliseconds";
import type { BriefingReceipt } from "./types";

const MAX_RECEIPTS = 4;
const MAX_ERROR_SHAPES = 2;
const ERROR_REGRESSION_RATIO = 1.5;
const ERROR_REGRESSION_ABSOLUTE = 2;
const SHARED_SIGNAL_MIN_COUNT = 2;
const LATENCY_REGRESSION_RATIO = 1.25;
const LATENCY_REGRESSION_ABSOLUTE_MS = 250;

export interface CountedSignal {
  value: string;
  count: number;
}

/** Inputs already returned by the briefing's existing analytics/facet APIs. */
export interface AttentionInboxSignals {
  slug?: string;
  /** Undefined means the error-message facet did not resolve. */
  currentErrorShapes?: CountedSignal[];
  /** Undefined means there is no trustworthy comparison window. */
  previousErrorShapes?: CountedSignal[];
  /** True only when the prior facet page covers every distinct value. */
  previousErrorShapesComplete?: boolean;
  /** Error-scoped trace-name groups from the analytics response. */
  sharedTraceNames?: CountedSignal[];
  /** Exact grouped error count when the analytics response can provide it. */
  errorTraces?: number;
  p50Latency?: number;
  previousP50Latency?: number;
}

interface AggregatedShape {
  key: string;
  /** Full facet values used by the trace query; never truncate evidence. */
  values: string[];
  count: number;
}

interface RankedReceipt {
  priority: number;
  receipt: BriefingReceipt;
}

/**
 * Collapse request ids, UUIDs and timestamp-like values without erasing useful
 * distinctions such as HTTP 429 vs 500. Facet counts are exact-message counts;
 * this small normalizer turns volatile instances into comparable shapes.
 */
export function normalizeErrorShape(message: string): string {
  return message
    .trim()
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<id>",
    )
    .replace(/\b(?:req|run|trace|span|job|task)_[a-z0-9_-]{8,}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "<time>")
    .replace(/\b\d{6,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function truncate(value: string, length = 92): string {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length <= length ? clean : `${clean.slice(0, length - 1)}…`;
}

function aggregateShapes(signals: CountedSignal[]): AggregatedShape[] {
  const byShape = new Map<string, AggregatedShape>();
  for (const signal of signals) {
    if (!signal.value.trim() || signal.count <= 0) continue;
    const key = normalizeErrorShape(signal.value);
    if (!key) continue;
    const existing = byShape.get(key);
    if (existing) {
      existing.count += signal.count;
      existing.values.push(signal.value.trim().replace(/\s+/g, " "));
    } else {
      byShape.set(key, {
        key,
        values: [signal.value.trim().replace(/\s+/g, " ")],
        count: signal.count,
      });
    }
  }
  return [...byShape.values()].sort((a, b) => b.count - a.count);
}

function quoteQueryValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Trace Explorer hash-state link for one concrete attention query. */
export function buildAttentionTraceHref(
  slug: string | undefined,
  query: string,
): string | undefined {
  if (!slug) return undefined;
  const params = new URLSearchParams({ q: query, preset: "30d" });
  return `/${slug}/traces#all-traces?${params.toString()}`;
}

function receiptEvidence({
  id,
  label,
  query,
  meta,
}: {
  id: string;
  label: string;
  query: string;
  meta?: Record<string, string | number | boolean>;
}) {
  return {
    // Filter attachments forward `id` as the agent-visible ref, so the exact
    // query — not an opaque receipt id — is the resource Langy receives.
    context: {
      id: query,
      label,
      query,
      ...(meta ? { meta: { receiptId: id, ...meta } } : {}),
    },
    link: {
      label: "Open traces",
      href: buildAttentionTraceHref(undefined, query) ?? "#",
    },
  };
}

function withSlug(
  receipt: BriefingReceipt,
  slug: string | undefined,
): BriefingReceipt {
  if (!receipt.link || !receipt.context) return receipt;
  return {
    ...receipt,
    link: {
      ...receipt.link,
      href: buildAttentionTraceHref(slug, receipt.context.query) ?? "#",
    },
  };
}

/**
 * Build a compact attention inbox. Changed error shapes lead, then repeated
 * cross-trace signals, then a period-over-period latency regression. Raw totals
 * and one-off maxima deliberately do not become insight cards.
 */
export function buildAttentionInbox(
  signals: AttentionInboxSignals,
): BriefingReceipt[] {
  const currentShapes = aggregateShapes(signals.currentErrorShapes ?? []);
  const previousShapes = aggregateShapes(signals.previousErrorShapes ?? []);
  const previousByShape = new Map(
    previousShapes.map((shape) => [shape.key, shape.count]),
  );
  const hasShapeBaseline = signals.previousErrorShapes !== undefined;
  const canProveShapeAbsent = signals.previousErrorShapesComplete === true;
  const ranked: RankedReceipt[] = [];

  for (const shape of currentShapes.slice(0, MAX_ERROR_SHAPES)) {
    const previous = previousByShape.get(shape.key) ?? 0;
    // A facet page is top-N. Absence only proves "new" when totalDistinct says
    // the previous page was exhaustive; otherwise keep the honest repeated /
    // observed wording while still surfacing the concrete current evidence.
    const isNew = canProveShapeAbsent && previous === 0;
    const isRegressed =
      previous > 0 &&
      shape.count >= previous + ERROR_REGRESSION_ABSOLUTE &&
      shape.count / previous >= ERROR_REGRESSION_RATIO;
    const isRepeated = shape.count >= SHARED_SIGNAL_MIN_COUNT;

    const status = isNew
      ? "new"
      : isRegressed
        ? "regressed"
        : isRepeated
          ? "repeated"
          : "observed";
    const displayShape = truncate(shape.values[0]!);
    const shapeClauses = shape.values.map(
      (value) => `errorMessage:${quoteQueryValue(value)}`,
    );
    const query =
      shapeClauses.length === 1
        ? shapeClauses[0]!
        : `(${shapeClauses.join(" OR ")})`;
    const label = `${status === "observed" ? "Error" : `${status} error shape`}: ${displayShape}`;
    const evidence = receiptEvidence({
      id: `error-shape:${shape.key}`,
      label,
      query,
      meta: {
        kind: "error-shape",
        status,
        count: shape.count,
        ...(hasShapeBaseline ? { previousCount: previous } : {}),
      },
    });

    ranked.push({
      priority: isNew ? 0 : isRegressed ? 1 : isRepeated ? 4 : 6,
      receipt: withSlug(
        {
          id: `error-shape:${shape.key}`,
          severity: "error",
          subject: isNew
            ? "New error shape"
            : isRegressed
              ? "Error shape regressed"
              : isRepeated
                ? "Repeated error shape"
                : "Error shape observed",
          detail: `“${displayShape}” on ${shape.count} ${shape.count === 1 ? "trace" : "traces"}.`,
          // No metric for a NEW shape: the subject already says "New error
          // shape", so an extra "new" tag was noise. The regression keeps its
          // comparison — that figure carries real information.
          metric: isRegressed
            ? {
                text: `${shape.count} vs ${previous}`,
                tone: "up",
              }
            : undefined,
          ...evidence,
          askPrompt: `Investigate the ${status} error shape “${displayShape}” across the matching traces. Show the shared evidence and do not claim a root cause unless the traces prove it.`,
        },
        signals.slug,
      ),
    });
  }

  const sharedTraceName = [...(signals.sharedTraceNames ?? [])]
    .filter(
      (signal) =>
        signal.value.trim() && signal.count >= SHARED_SIGNAL_MIN_COUNT,
    )
    .sort((a, b) => b.count - a.count)[0];
  if (sharedTraceName) {
    const name = truncate(sharedTraceName.value, 60);
    const query = `status:error AND traceName:${quoteQueryValue(name)}`;
    const evidence = receiptEvidence({
      id: `shared-trace-name:${normalizeErrorShape(name)}`,
      label: `Shared error signal: ${name}`,
      query,
      meta: {
        kind: "shared-signal",
        signal: "trace-name",
        count: sharedTraceName.count,
      },
    });
    ranked.push({
      priority: 2,
      receipt: withSlug(
        {
          id: `shared-trace-name:${normalizeErrorShape(name)}`,
          severity: "attention",
          subject: "Shared error signal",
          detail: `${sharedTraceName.count} errored traces share “${name}”. Correlation, not a confirmed cause.`,
          ...evidence,
          askPrompt: `Investigate why ${sharedTraceName.count} errored traces share the trace name “${name}”. Treat it as a correlation, not a confirmed cause, and cite the supporting traces.`,
        },
        signals.slug,
      ),
    });
  }

  const currentLatency = signals.p50Latency;
  const previousLatency = signals.previousP50Latency;
  if (
    currentLatency !== undefined &&
    currentLatency > 0 &&
    previousLatency !== undefined &&
    previousLatency > 0
  ) {
    const ratio = currentLatency / previousLatency;
    const delta = currentLatency - previousLatency;
    if (
      ratio >= LATENCY_REGRESSION_RATIO &&
      delta >= LATENCY_REGRESSION_ABSOLUTE_MS
    ) {
      const percent = Math.round((ratio - 1) * 100);
      const query = `duration:>${Math.round(currentLatency)}`;
      const evidence = receiptEvidence({
        id: "latency-regression",
        label: `Latency regression: p50 ${formatMilliseconds(currentLatency)}`,
        query,
        meta: {
          kind: "latency-regression",
          currentMs: currentLatency,
          previousMs: previousLatency,
        },
      });
      ranked.push({
        priority: 3,
        receipt: withSlug(
          {
            id: "latency-regression",
            severity: "attention",
            subject: "Latency regressed",
            detail: `p50 is ${percent}% slower than the prior 30 days.`,
            metric: {
              text: formatMilliseconds(currentLatency),
              tone: "up",
            },
            ...evidence,
            askPrompt: `Explain the ${percent}% p50 latency regression versus the prior 30 days. Compare the matching slow traces and separate evidence from hypotheses.`,
          },
          signals.slug,
        ),
      });
    }
  }

  const hasErrorReceipt = ranked.some(({ receipt }) =>
    receipt.id.startsWith("error-shape:"),
  );
  if (!hasErrorReceipt && (signals.errorTraces ?? 0) > 0) {
    const count = signals.errorTraces!;
    const query = "status:error";
    const evidence = receiptEvidence({
      id: "errors-unclassified",
      label: `${count} errored traces need triage`,
      query,
      meta: { kind: "errors-unclassified", count },
    });
    ranked.push({
      priority: 5,
      receipt: withSlug(
        {
          id: "errors-unclassified",
          severity: "error",
          subject: `${count} errored ${count === 1 ? "trace" : "traces"}`,
          detail:
            "This read cannot prove a shared error shape or cause yet; start with the matching traces.",
          ...evidence,
          askPrompt:
            "Triage the errored traces in this briefing. Cluster only what the trace evidence supports and say explicitly when a shared cause cannot be proven.",
        },
        signals.slug,
      ),
    });
  }

  return ranked
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_RECEIPTS)
    .map(({ receipt }) => receipt);
}
