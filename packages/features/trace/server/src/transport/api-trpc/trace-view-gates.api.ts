import type { Evaluation } from "@langwatch/trace-contract";
import { NON_BILLABLE_ATTR } from "@langwatch/trace-contract";
import { TraceAttributeRedactor } from "../../services/trace-attribute-redaction.service";
import {
  canReadCapturedContent,
  type Protections,
} from "../../services/trace-viewer-protections.service";

import type {
  SpanTreeNode,
  TraceHeader,
  TraceResourceInfoDto,
} from "@langwatch/trace-contract";

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
 *
 * The two transports that call these still live in the application; the gates
 * are here because they are the trace read's rule, not the transport's, and
 * because a package-owned gate cannot be quietly re-implemented by whichever
 * surface is written next.
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

/**
 * Strip session spend from Sessions-lens rows for a viewer without cost:view.
 * A per-session rollup is strictly more revealing than the per-trace cost the
 * header and waterfall already gate, so it follows the same permission.
 * Zeroed rather than nulled: the row's cost is a total, and the chips that
 * render it already treat zero as "nothing to show".
 */
export function gateSessionCost<T extends { totalCost: number }>({
  sessions,
  protections,
}: {
  sessions: T[];
  protections: Protections;
}): T[] {
  if (protections.canSeeCosts === true) return sessions;
  return sessions.map((session) => ({ ...session, totalCost: 0 }));
}

/**
 * Strip the generated session title from Sessions-lens rows for a viewer who
 * may not read captured content.
 *
 * The title is written BY the model FROM the conversation, a one-line summary
 * of what the human asked for, so it follows content visibility
 * (`canReadCapturedContent`) rather than the cost permission. The git identity
 * on the same object is operational metadata about where the session ran and
 * is deliberately untouched.
 *
 * `titleRedacted` is set only when there WAS a title, mirroring
 * `redactV2Content`: an ordinary session that never had one must not render
 * the redaction placeholder.
 */
export function gateSessionTitle<
  T extends { codingAgent: { title: string | null } | null },
>({
  sessions,
  protections,
}: {
  sessions: T[];
  protections: Protections;
}): Array<
  T & {
    codingAgent: (NonNullable<T["codingAgent"]> & SessionTitleRedactionFlag) | null;
  }
> {
  const contentVisible = canReadCapturedContent(protections);
  return sessions.map((session) => {
    const codingAgent = session.codingAgent as NonNullable<T["codingAgent"]> | null;
    return {
      ...session,
      codingAgent:
        codingAgent === null
          ? null
          : {
              ...codingAgent,
              title: contentVisible ? codingAgent.title : null,
              titleRedacted: !contentVisible && codingAgent.title !== null,
            },
    };
  });
}

/** What {@link gateSessionTitle} adds to a row's coding-agent enrichment. */
export interface SessionTitleRedactionFlag {
  /** True only when a title existed and this viewer may not read it. */
  titleRedacted: boolean;
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
    TraceAttributeRedactor.for(protections.hiddenAttributes).redact(attrs) ?? attrs;
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
    protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true;
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

/**
 * Internal cost-classification markers the receiver stamps on a span's
 * resource so the fold can roll the bundled portion into NonBilledCost. They
 * are plumbing, not user-facing metadata (the billed/bundled split is shown
 * as real amounts), so they are filtered out of the drawer's resource view.
 *
 * A fixed set, unlike {@link gateResources}: it depends on nothing about the
 * viewer. Both passes run on the resource DTO — this one first, so the rules
 * layer on top of it rather than around it.
 */
export const HIDDEN_RESOURCE_ATTRS: ReadonlySet<string> = new Set([NON_BILLABLE_ATTR]);

export function withoutHiddenResourceAttrs(
  attrs: Record<string, string>,
): Record<string, string> {
  let hasHidden = false;
  for (const key of HIDDEN_RESOURCE_ATTRS) {
    if (key in attrs) {
      hasHidden = true;
      break;
    }
  }
  if (!hasHidden) return attrs;
  return Object.fromEntries(
    Object.entries(attrs).filter(([key]) => !HIDDEN_RESOURCE_ATTRS.has(key)),
  );
}
