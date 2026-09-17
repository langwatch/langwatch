import type { Protections,Evaluation,SpanTreeNode,TraceHeader,TraceResourceInfoDto } from "@langwatch/trace-contract";
import { TraceViewerProtectionsService } from "../../services/trace-viewer-protections.service.ts";
import { NON_BILLABLE_ATTR } from "@langwatch/trace-contract";
import { TraceAttributeRedactionService } from "../../services/trace-attribute-redaction.service.ts";


/**
 * Gates for v2 trace read DTOs: enforces same Protections on both transports
 * (authenticated and anonymous share). Cost gated by cost:view permission.
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
 * Strip session spend for viewers without cost:view. Zeroed rather than nulled
 * to match existing chip rendering.
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
 * Strip session title for viewers who cannot read captured content. `titleRedacted`
 * set only when a title existed (mirrors redactV2Content).
 */
export function gateSessionTitle<T extends { codingAgent: { title: string | null } | null }>({
  sessions,
  protections,
}: {
  sessions: T[];
  protections: Protections;
}): (T & {
  codingAgent: (NonNullable<T["codingAgent"]> & SessionTitleRedactionFlag) | null;
})[] {
  const contentVisible = TraceViewerProtectionsService.canReadCapturedContent(protections);
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
    TraceAttributeRedactionService.create(protections.hiddenAttributes).redact(attrs) ?? attrs;
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
 * Evaluator verdicts follow content visibility: inputs never shared, details
 * survive only for viewers who may read input AND output. Stacktraces never shared.
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
 * Internal cost-classification markers filtered from drawer resource view.
 * Fixed set, independent of viewer. Applied before gateResources.
 */
export const HIDDEN_RESOURCE_ATTRS: ReadonlySet<string> = new Set([NON_BILLABLE_ATTR]);

export function withoutHiddenResourceAttrs(attrs: Record<string, string>): Record<string, string> {
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
