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
    const explicitOrigin = span.spanAttributes["langwatch.origin"];
    const hasExplicitOrigin =
      typeof explicitOrigin === "string" && explicitOrigin !== "";

    if (hasExplicitOrigin) {
      // Explicit langwatch.origin on any span always wins — it's a
      // deliberate, high-confidence signal (SDK or platform).
      mergedAttributes["langwatch.origin"] = explicitOrigin as string;
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
