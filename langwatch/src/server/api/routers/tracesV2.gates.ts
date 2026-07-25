import type { Evaluation } from "~/server/tracer/types";
import { redactHiddenAttributes } from "~/server/traces/mappers/redactAttributes";
import type { Protections } from "~/server/traces/protections";

import type {
  SpanTreeNode,
  TraceHeader,
  TraceResourceInfoDto,
} from "./tracesV2.schemas";

/**
 * Viewer-scoped gates for the v2 trace read DTOs (header, span tree, resource
 * info, evaluator verdicts).
 *
 * These enforce the SAME `Protections` on BOTH trace surfaces so neither can
 * drift behind the other:
 *   - the authenticated in-app drawer (`tracesV2.*`, permission-checked), and
 *   - the anonymous share page (`sharedTrace.get`, token-validated).
 *
 * Cost is gated by the viewer's own `cost:view` permission (surfaced as
 * `protections.canSeeCosts`) — the legacy full-span path already strips per-span
 * cost via `applySpanProtections`, so the summary-derived header/tree DTOs must
 * strip it too or a viewer without `cost:view` would see in the header/waterfall
 * exactly the spend the detail pane hides. See ADR-057.
 */

/** Strip provider spend from a header for a viewer without cost:view. */
export function gateHeaderCost({
  header,
  protections,
}: {
  header: TraceHeader;
  protections: Protections;
}): TraceHeader {
  if (protections.canSeeCosts === true) return header;
  return { ...header, totalCost: null, nonBilledCost: 0 };
}

/** Strip per-span spend from waterfall nodes for a viewer without cost:view. */
export function gateTreeCost({
  nodes,
  protections,
}: {
  nodes: SpanTreeNode[];
  protections: Protections;
}): SpanTreeNode[] {
  if (protections.canSeeCosts === true) return nodes;
  return nodes.map((node) => (node.cost == null ? node : { ...node, cost: null }));
}

/** Redact resource attributes with the viewer's restricted-attribute rules. */
export function gateResources({
  resources,
  protections,
}: {
  resources: TraceResourceInfoDto;
  protections: Protections;
}): TraceResourceInfoDto {
  const redact = (attrs: Record<string, string>): Record<string, string> =>
    redactHiddenAttributes(attrs, protections.hiddenAttributes) ?? attrs;
  return {
    ...resources,
    resourceAttributes: redact(resources.resourceAttributes),
    spans: resources.spans.map((span) => ({
      ...span,
      resourceAttributes: redact(span.resourceAttributes),
    })),
  };
}

/**
 * Evaluator verdicts follow content visibility: `inputs` echo captured trace
 * content verbatim and are never shared; `details` is free-text evaluator
 * output that routinely quotes BOTH the trace's input and output, and an
 * error's `message` can do the same. Both therefore survive only for a viewer
 * who may read input AND output — a viewer allowed one side but not the other
 * could otherwise reconstruct the hidden side from the free text. Stacktraces
 * are internal implementation detail and are never shared.
 */
export function gateEvaluations({
  evaluations,
  protections,
}: {
  evaluations: Evaluation[];
  protections: Protections;
}): Evaluation[] {
  const contentVisible =
    protections.canSeeCapturedInput === true &&
    protections.canSeeCapturedOutput === true;
  return evaluations.map((evaluation) => ({
    ...evaluation,
    inputs: undefined,
    details: contentVisible ? evaluation.details : null,
    error: evaluation.error
      ? {
          ...evaluation.error,
          message: contentVisible ? evaluation.error.message : "",
          stacktrace: [],
        }
      : evaluation.error,
  }));
}
