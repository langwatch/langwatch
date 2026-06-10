import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { parseJsonStringArray } from "./trace-summary.utils";

/**
 * Rules for inferring trace origin from legacy span markers.
 * Checked in order; first match wins.
 */
export const LEGACY_ORIGIN_RULES: Array<{
  check: (span: NormalizedSpan) => boolean;
  origin: string;
}> = [
  {
    check: (s) => s.instrumentationScope?.name === "langwatch-evaluation",
    origin: "evaluation",
  },
  {
    check: (s) => s.instrumentationScope?.name === "@langwatch/scenario",
    origin: "simulation",
  },
  {
    check: (s) =>
      s.spanAttributes["metadata.platform"] === "optimization_studio",
    origin: "workflow",
  },
  {
    check: (s) => {
      const labels = s.spanAttributes[ATTR_KEYS.LANGWATCH_LABELS];
      const arr =
        typeof labels === "string"
          ? parseJsonStringArray(labels)
          : Array.isArray(labels)
            ? (labels as string[])
            : [];
      return arr.includes("scenario-runner");
    },
    origin: "simulation",
  },
  {
    check: (s) => s.resourceAttributes["scenario.labels"] !== undefined,
    origin: "simulation",
  },
  {
    check: (s) => s.spanAttributes["evaluation.run_id"] !== undefined,
    origin: "evaluation",
  },
];

/**
 * Resolves and hoists `langwatch.origin` and `langwatch.origin.source`
 * into trace-level attributes, handling explicit values, legacy markers,
 * and SDK-presence heuristics.
 */
export class TraceOriginService {
  inferOriginFromLegacyMarkers(span: NormalizedSpan): string | undefined {
    for (const rule of LEGACY_ORIGIN_RULES) {
      if (rule.check(span)) return rule.origin;
    }
    return undefined;
  }

  /**
   * Strips legacy marker attributes that have been superseded by
   * `langwatch.origin`. Mutates `mergedAttributes` in place.
   *
   * TODO(2027): remove once all clients are upgraded
   */
  stripLegacyMarkers(mergedAttributes: Record<string, string>): void {
    if (mergedAttributes["metadata.platform"] === "optimization_studio") {
      delete mergedAttributes["metadata.platform"];
    }

    if (mergedAttributes["langwatch.labels"]) {
      const allLabels = parseJsonStringArray(
        mergedAttributes["langwatch.labels"],
      );
      const filtered = allLabels.filter((l) => l !== "scenario-runner");
      if (filtered.length > 0) {
        mergedAttributes["langwatch.labels"] = JSON.stringify(filtered);
      } else {
        delete mergedAttributes["langwatch.labels"];
      }
    }
  }

  hoistOrigin({
    state,
    span,
    mergedAttributes,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    mergedAttributes: Record<string, string>;
  }): void {
    const isRootSpan = span.parentSpanId === null;
    // The ingest-key provenance stamp writes langwatch.origin onto the RESOURCE
    // attributes (so an upstream payload can't forge a different origin per
    // span) — e.g. Claude Code's log-derived spans carry `coding_agent` only on
    // the resource, never on the span. Treat a resource-level origin as an
    // explicit signal too, falling back to it when the span carries none, so
    // these traces resolve their origin deterministically at fold time instead
    // of decaying to the deferred "application" fallback when the fold is slow.
    const spanOrigin = span.spanAttributes["langwatch.origin"];
    const resourceOrigin = span.resourceAttributes["langwatch.origin"];
    const explicitOrigin =
      typeof spanOrigin === "string" && spanOrigin !== ""
        ? spanOrigin
        : resourceOrigin;
    const hasExplicitOrigin =
      typeof explicitOrigin === "string" && explicitOrigin !== "";
    const existingOrigin = state.attributes["langwatch.origin"];

    // Eval-chain detection: nlpgo's BaggageAttributeProcessor stamps
    // langwatch.reserved.causality_depth on every span emitted during
    // an evaluator workflow run (set by post-PR-#4048 loop prevention).
    // A non-root span with depth>=1 is by definition an eval child
    // riding in on someone else's traceparent — its origin must NOT
    // be allowed to flip the customer trace's resolved origin.
    const rawDepth = span.spanAttributes["langwatch.reserved.causality_depth"];
    const causalityDepth =
      typeof rawDepth === "string"
        ? parseInt(rawDepth, 10) || 0
        : typeof rawDepth === "number"
          ? rawDepth
          : 0;
    const isEvalChainChild = !isRootSpan && causalityDepth >= 1;

    if (hasExplicitOrigin) {
      if (isEvalChainChild && existingOrigin) {
        // 2026-05-14 prod regression: eval workflow spans now continue
        // the parent trace via W3C traceparent (PR #4048). They land on
        // the customer's trace as children with origin="evaluation" +
        // causality_depth=1; the previous "explicit always wins" rule
        // then flipped the trace summary's origin from playground /
        // application to evaluation as the eval spans arrived.
        mergedAttributes["langwatch.origin"] = existingOrigin;
      } else {
        // Explicit langwatch.origin on any other span wins — it's a
        // deliberate, high-confidence signal (SDK or platform). This
        // also covers the SDK-heuristic-application → explicit-platform
        // upgrade path on distributed traces where the root span isn't
        // the platform's root.
        mergedAttributes["langwatch.origin"] = explicitOrigin as string;
      }
    } else {
      // For root spans, always try legacy markers first — a root with a
      // legacy marker should override a provisional origin (e.g. "application")
      // set by an earlier-arriving child via the sdk.name heuristic.
      const inferred = this.inferOriginFromLegacyMarkers(span);
      if (isRootSpan && inferred) {
        mergedAttributes["langwatch.origin"] = inferred;
      } else if (inferred && !state.attributes["langwatch.origin"]) {
        mergedAttributes["langwatch.origin"] = inferred;
      } else if (state.attributes["langwatch.origin"]) {
        mergedAttributes["langwatch.origin"] =
          state.attributes["langwatch.origin"];
      } else if (isRootSpan && mergedAttributes["sdk.name"]) {
        // SDK heuristic: only on root spans. sdk.name is a resource
        // attribute identical across ALL spans — inferring origin from it
        // on child spans creates a race where origin flips from "application"
        // to the real value when the platform span arrives.
        mergedAttributes["langwatch.origin"] = "application";
      }
    }
  }

  hoistSource({
    state,
    span,
    mergedAttributes,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    mergedAttributes: Record<string, string>;
  }): void {
    const isRootSpan = span.parentSpanId === null;
    const explicitSource = span.spanAttributes["langwatch.origin.source"] as
      | string
      | undefined;
    if (typeof explicitSource === "string" && explicitSource !== "") {
      if (isRootSpan) {
        mergedAttributes["langwatch.origin.source"] = explicitSource;
      } else if (!state.attributes["langwatch.origin.source"]) {
        mergedAttributes["langwatch.origin.source"] = explicitSource;
      } else {
        mergedAttributes["langwatch.origin.source"] =
          state.attributes["langwatch.origin.source"];
      }
    } else if (state.attributes["langwatch.origin.source"]) {
      mergedAttributes["langwatch.origin.source"] =
        state.attributes["langwatch.origin.source"];
    }
  }
}
