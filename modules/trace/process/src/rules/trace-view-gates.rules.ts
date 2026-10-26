import { NON_BILLABLE_ATTR } from "@langwatch/span-normalisation";
import type {
  Protections,
  Evaluation,
  SpanTreeNode,
  SpanResourceInfo,
  TraceHeader,
  TraceResourceInfoDto,
} from "@langwatch/trace-contract";

import { protectByOwner } from "./braided-span-owner.rules.ts";
import { createAttributeRedactor } from "./trace-attribute-redaction.rules.ts";

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

/** Each span's spend gated by its owner's cost:view, the reader's by theirs (ADR-185 §5). */
export function gateTreeCostByOwner({
  nodes,
  reader,
  owners,
}: {
  nodes: SpanTreeNode[];
  reader: Protections;
  owners: ReadonlyMap<string, Protections>;
}): SpanTreeNode[] {
  return protectByOwner({
    items: nodes,
    reader,
    owners,
    protect: (group, protections) => gateTreeCost({ nodes: group, protections }),
  });
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
 * The resource pane: the trace's resources from the reader's root span (a braided span is never
 * the root), and every span's, each gated by its owner's protections (ADR-185 §5).
 */
export function resourceInfoOf({
  rows,
  protections,
  ownerProtections,
}: {
  rows: SpanResourceInfo[];
  protections: Protections;
  ownerProtections: ReadonlyMap<string, Protections>;
}): TraceResourceInfoDto {
  const ownRows = rows.filter((row) => row.ownerProjectId === undefined);
  const root = ownRows.find((row) => row.parentSpanId == null) ?? ownRows[0] ?? null;
  return gateResources({
    resources: {
      rootSpanId: root?.spanId ?? null,
      resourceAttributes: withoutHiddenResourceAttrs(root?.resourceAttributes ?? {}),
      scope: root ? { name: root.scopeName ?? "", version: root.scopeVersion } : null,
      spans: rows.map((row) => ({
        spanId: row.spanId,
        parentSpanId: row.parentSpanId,
        resourceAttributes:
          row.ownerProjectId === undefined
            ? withoutHiddenResourceAttrs(row.resourceAttributes)
            : withoutIngestKey(row.resourceAttributes),
        scope: { name: row.scopeName ?? "", version: row.scopeVersion },
        ...(row.ownerProjectId === undefined ? {} : { ownerProjectId: row.ownerProjectId }),
      })),
    },
    protections,
    ownerProtections,
  });
}

/**
 * Redact resource attributes with the viewer's restricted-attribute rules; a braided span's with
 * its owner's (ADR-185 §5), and every attribute of an owner whose protections were not resolved.
 */
export function gateResources({
  resources,
  protections,
  ownerProtections = new Map(),
}: {
  resources: TraceResourceInfoDto;
  protections: Protections;
  ownerProtections?: ReadonlyMap<string, Protections>;
}): TraceResourceInfoDto {
  const redactWith =
    (hidden: Protections["hiddenAttributes"]) =>
    (attrs: Record<string, string>): Record<string, string> =>
      createAttributeRedactor({ hidden })(attrs) ?? attrs;
  const redact = redactWith(protections.hiddenAttributes);
  const redactOwned = (
    ownerProjectId: string,
  ): ((attrs: Record<string, string>) => Record<string, string>) =>
    redactWith(
      ownerProtections.get(ownerProjectId)?.hiddenAttributes ?? [
        { pattern: "*", visibleTo: "members of the owning project" },
      ],
    );
  return {
    ...resources,
    resourceAttributes: redact(resources.resourceAttributes),
    spans: resources.spans.map((span) => ({
      ...span,
      resourceAttributes: (span.ownerProjectId ? redactOwned(span.ownerProjectId) : redact)(
        span.resourceAttributes,
      ),
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
    last_attempt_error: contentVisible ? evaluation.last_attempt_error : null,
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
const HIDDEN_RESOURCE_ATTRS: ReadonlySet<string> = new Set([NON_BILLABLE_ATTR]);

/** Stamped by the ingestion receiver: the key a span was sent with, the sending project's own. */
export const API_KEY_ID_ATTRIBUTE = "langwatch.api_key.id";

/** Resources shown outside the project that sent them: a share page, or a braided span. */
export function withoutIngestKey(attrs: Record<string, string>): Record<string, string> {
  const { [API_KEY_ID_ATTRIBUTE]: _apiKeyId, ...rest } = withoutHiddenResourceAttrs(attrs);
  return rest;
}

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
