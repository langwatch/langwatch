// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Receiver-side provenance stamping for traces / logs / metrics landed via an
 * ingestion key (a project-scoped, ingest-only ApiKey with `ingestSourceType`
 * set). The
 * receiver mutates the parsed OTLP request in-place to overwrite a fixed set of
 * resource attributes on every resource, so a malicious upstream payload can
 * never forge a different source / key / org identity onto its own traces:
 *
 *   - langwatch.source         (ingestSourceType — drives the /me/traces filter)
 *   - langwatch.api_key.id      (the ingestion key id)
 *   - langwatch.origin          ("coding_agent" for a CLI coding assistant,
 *                               "ai_tool" for any other ingest source) —
 *                               discriminator the governance content-strip /
 *                               no-spy policy keys on (must be in
 *                               GOVERNED_ORIGINS).
 *   - langwatch.organization_id (feeds the no-spy policy org lookup)
 *   - langwatch.template.id     (only when the key carries an ingestionTemplateId,
 *                               e.g. claude_cowork)
 */

export interface IngestKeyProvenance {
  apiKeyId: string;
  /** Tool slug (claude_code / codex / gemini / opencode / claude_cowork). */
  sourceType: string;
  /** Org id of the bound project — feeds the no-spy policy lookup. */
  organizationId: string;
  /** Only set for template-derived ingest keys (e.g. claude_cowork). */
  templateId?: string | null;
  /**
   * Whether this tool's direct-OTLP usage is part of a bundled subscription
   * (not billed per token). Resolved from the org's coding-assistant tile
   * (`config.bundledPlan`, default true for the ingest path). Stamped so the
   * trace summary can split billed vs non-billed cost. Omitted → not stamped
   * (the trace is treated as billed).
   */
  nonBillable?: boolean;
}

export const PROVENANCE_ATTR_SOURCE = "langwatch.source" as const;
export const PROVENANCE_ATTR_API_KEY_ID = "langwatch.api_key.id" as const;
export const PROVENANCE_ATTR_ORIGIN = "langwatch.origin" as const;
export const PROVENANCE_ATTR_ORGANIZATION_ID =
  "langwatch.organization_id" as const;
export const PROVENANCE_ATTR_TEMPLATE_ID = "langwatch.template.id" as const;
/**
 * Receiver-stamped marker: "true" when the trace's LLM usage is bundled into a
 * subscription (not billed per token). Read by the trace summary / cost split.
 */
export const PROVENANCE_ATTR_NON_BILLABLE = "langwatch.cost.non_billable" as const;

/**
 * Trace origin stamped on ingest-key traces, derived from the key's
 * `ingestSourceType`. A CLI coding assistant (claude code / codex / gemini /
 * opencode / cursor) becomes `coding_agent`; every other ingest source
 * (claude_cowork, otel_generic, compliance pulls, admin templates, …) becomes
 * the generic `ai_tool`.
 */
export const CODING_AGENT_ORIGIN_VALUE = "coding_agent" as const;
export const AI_TOOL_ORIGIN_VALUE = "ai_tool" as const;

/**
 * Source-type slugs that represent a CLI coding assistant wrapped by
 * `langwatch <tool>`. Mirrors ASSISTANT_KIND_TO_TOOL_SLUG in
 * aiToolEntry.service.ts. Anything not in this set is treated as a generic
 * AI tool.
 */
const CODING_AGENT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
]);

/**
 * Maps an ingestion-key `ingestSourceType` to the trace origin surfaced in the
 * UI. Coding CLIs get `coding_agent`; any other ingest source gets `ai_tool`.
 */
export function originForIngestSourceType(sourceType: string): string {
  return CODING_AGENT_SOURCE_TYPES.has(sourceType)
    ? CODING_AGENT_ORIGIN_VALUE
    : AI_TOOL_ORIGIN_VALUE;
}

const PROVENANCE_KEYS: readonly string[] = [
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_API_KEY_ID,
  PROVENANCE_ATTR_ORIGIN,
  PROVENANCE_ATTR_ORGANIZATION_ID,
  PROVENANCE_ATTR_TEMPLATE_ID,
  PROVENANCE_ATTR_NON_BILLABLE,
];

type OtlpAttribute = {
  key: string;
  value: { stringValue?: string | null } & Record<string, unknown>;
};
type OtlpResource = { attributes?: OtlpAttribute[] | null };
type OtlpResourceSpans = { resource?: OtlpResource | null };
type OtlpTraceRequest = { resourceSpans?: OtlpResourceSpans[] | null };
type OtlpResourceLogs = { resource?: OtlpResource | null };
type OtlpLogRequest = { resourceLogs?: OtlpResourceLogs[] | null };
type OtlpResourceMetrics = { resource?: OtlpResource | null };
type OtlpMetricRequest = { resourceMetrics?: OtlpResourceMetrics[] | null };

export function stampIngestKeyProvenanceOnTraceRequest(
  request: OtlpTraceRequest,
  provenance: IngestKeyProvenance,
): number {
  if (!request.resourceSpans) return 0;
  let stamped = 0;
  for (const rs of request.resourceSpans) {
    if (!rs.resource) rs.resource = { attributes: [] };
    if (!rs.resource.attributes) rs.resource.attributes = [];
    rs.resource.attributes = stripProvenanceKeys(rs.resource.attributes);
    rs.resource.attributes.push(...buildProvenanceAttributes(provenance));
    stamped++;
  }
  return stamped;
}

export function stampIngestKeyProvenanceOnLogRequest(
  request: OtlpLogRequest,
  provenance: IngestKeyProvenance,
): number {
  if (!request.resourceLogs) return 0;
  let stamped = 0;
  for (const rl of request.resourceLogs) {
    if (!rl.resource) rl.resource = { attributes: [] };
    if (!rl.resource.attributes) rl.resource.attributes = [];
    rl.resource.attributes = stripProvenanceKeys(rl.resource.attributes);
    rl.resource.attributes.push(...buildProvenanceAttributes(provenance));
    stamped++;
  }
  return stamped;
}

export function stampIngestKeyProvenanceOnMetricRequest(
  request: OtlpMetricRequest,
  provenance: IngestKeyProvenance,
): number {
  if (!request.resourceMetrics) return 0;
  let stamped = 0;
  for (const rm of request.resourceMetrics) {
    if (!rm.resource) rm.resource = { attributes: [] };
    if (!rm.resource.attributes) rm.resource.attributes = [];
    rm.resource.attributes = stripProvenanceKeys(rm.resource.attributes);
    rm.resource.attributes.push(...buildProvenanceAttributes(provenance));
    stamped++;
  }
  return stamped;
}

function buildProvenanceAttributes(
  provenance: IngestKeyProvenance,
): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [
    { key: PROVENANCE_ATTR_SOURCE, value: { stringValue: provenance.sourceType } },
    { key: PROVENANCE_ATTR_API_KEY_ID, value: { stringValue: provenance.apiKeyId } },
    {
      key: PROVENANCE_ATTR_ORIGIN,
      value: { stringValue: originForIngestSourceType(provenance.sourceType) },
    },
    { key: PROVENANCE_ATTR_ORGANIZATION_ID, value: { stringValue: provenance.organizationId } },
  ];
  if (provenance.templateId) {
    attrs.push({
      key: PROVENANCE_ATTR_TEMPLATE_ID,
      value: { stringValue: provenance.templateId },
    });
  }
  if (provenance.nonBillable !== undefined) {
    attrs.push({
      key: PROVENANCE_ATTR_NON_BILLABLE,
      value: { stringValue: provenance.nonBillable ? "true" : "false" },
    });
  }
  return attrs;
}

function stripProvenanceKeys(attrs: OtlpAttribute[]): OtlpAttribute[] {
  return attrs.filter((a) => !PROVENANCE_KEYS.includes(a.key));
}
