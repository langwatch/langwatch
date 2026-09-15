import { ATTR_KEYS, type NormalizedSpan, type TraceSummaryData } from "@langwatch/trace-contract";
import { parseJsonStringArray } from "../../rules/trace-summary-attributes.rules.ts";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : void 0;
}

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
    check: (s) => s.spanAttributes["metadata.platform"] === "optimization_studio",
    origin: "workflow",
  },
  {
    check: (s) => {
      const labels = s.spanAttributes[ATTR_KEYS.LANGWATCH_LABELS];
      const labelsFromString = typeof labels === "string" ? parseJsonStringArray(labels) : [];
      const arr = Array.isArray(labels)
        ? labels.filter((label): label is string => typeof label === "string")
        : labelsFromString;

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
  private constructor() {}

  static create(): TraceOriginService {
    return new TraceOriginService();
  }

  tryInferOriginFromLegacyMarkers(span: NormalizedSpan): string | undefined {
    for (const rule of LEGACY_ORIGIN_RULES) {
      if (rule.check(span)) {
        return rule.origin;
      }
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
      const allLabels = parseJsonStringArray(mergedAttributes["langwatch.labels"]);
      const filtered = allLabels.filter((l) => l !== "scenario-runner");
      if (filtered.length > 0) {
        mergedAttributes["langwatch.labels"] = JSON.stringify(filtered);
      } else {
        delete mergedAttributes["langwatch.labels"];
      }
    }
  }

  /**
   * Eval-chain detection: nlpgo's BaggageAttributeProcessor stamps
   * langwatch.reserved.causality_depth on every span emitted during an evaluator workflow run
   * (post-PR-#4048 loop prevention). A non-root span with depth >= 1 is by definition an eval
   * child riding in on someone else's traceparent.
   */
  #isEvalChainChild(span: NormalizedSpan, isRootSpan: boolean): boolean {
    const rawDepth = span.spanAttributes["langwatch.reserved.causality_depth"];
    const numericDepth = typeof rawDepth === "number" ? rawDepth : 0;
    const causalityDepth =
      typeof rawDepth === "string" ? parseInt(rawDepth, 10) || 0 : numericDepth;

    return !isRootSpan && causalityDepth >= 1;
  }

  /**
   * Which origin survives when a span declares one. An eval child never flips the customer
   * trace's origin (2026-05-14 prod regression: eval spans continue the parent trace via W3C
   * traceparent and arrived with origin="evaluation"), and once a trace has resolved to "langy"
   * a gateway span never displaces it — a Langy turn carries BOTH platform origins, and under
   * "explicit always wins" whichever span folded last decided the summary. Otherwise explicit
   * wins: it is a deliberate, high-confidence SDK or platform signal.
   */
  #resolveExplicitOrigin({
    explicitOrigin,
    existingOrigin,
    isEvalChainChild,
  }: {
    explicitOrigin: string;
    existingOrigin: string | undefined;
    isEvalChainChild: boolean;
  }): string {
    if (isEvalChainChild && existingOrigin) {
      return existingOrigin;
    }

    if (existingOrigin === "langy" && explicitOrigin === "gateway") {
      return existingOrigin;
    }

    return explicitOrigin;
  }

  /**
   * Which origin a span with no explicit one implies. A root span's legacy marker overrides a
   * provisional origin an earlier child set; the sdk.name heuristic is root-only, because
   * sdk.name is a resource attribute identical across ALL spans and inferring from it on a child
   * races the platform span's arrival.
   */
  #resolveInferredOrigin({
    state,
    span,
    mergedAttributes,
    isRootSpan,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    mergedAttributes: Record<string, string>;
    isRootSpan: boolean;
  }): string | undefined {
    const inferred = this.tryInferOriginFromLegacyMarkers(span);
    if (isRootSpan && inferred) {
      return inferred;
    }

    const existingOrigin = state.attributes["langwatch.origin"];
    if (inferred && !existingOrigin) {
      return inferred;
    }

    if (existingOrigin) {
      return existingOrigin;
    }

    return isRootSpan && mergedAttributes["sdk.name"] ? "application" : undefined;
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
    // the resource. A resource-level origin is an explicit signal too, so these
    // traces resolve deterministically at fold time instead of decaying to the
    // deferred "application" fallback when the fold is slow.
    const spanOrigin = span.spanAttributes["langwatch.origin"];
    const resourceOrigin = span.resourceAttributes["langwatch.origin"];
    const explicitOrigin = nonEmptyString(spanOrigin) ?? nonEmptyString(resourceOrigin);

    if (explicitOrigin) {
      mergedAttributes["langwatch.origin"] = this.#resolveExplicitOrigin({
        explicitOrigin,
        existingOrigin: state.attributes["langwatch.origin"],
        isEvalChainChild: this.#isEvalChainChild(span, isRootSpan),
      });

      return;
    }

    const inferred = this.#resolveInferredOrigin({ state, span, mergedAttributes, isRootSpan });
    if (inferred !== undefined) {
      mergedAttributes["langwatch.origin"] = inferred;
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
    const explicitSource = nonEmptyString(span.spanAttributes["langwatch.origin.source"]);
    if (explicitSource) {
      if (isRootSpan) {
        mergedAttributes["langwatch.origin.source"] = explicitSource;
      } else if (!state.attributes["langwatch.origin.source"]) {
        mergedAttributes["langwatch.origin.source"] = explicitSource;
      } else {
        mergedAttributes["langwatch.origin.source"] = state.attributes["langwatch.origin.source"];
      }
    } else if (state.attributes["langwatch.origin.source"]) {
      mergedAttributes["langwatch.origin.source"] = state.attributes["langwatch.origin.source"];
    }
  }
}
