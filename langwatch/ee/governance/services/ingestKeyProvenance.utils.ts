// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Receiver-side provenance stamping for traces / logs landed via an ingestion
 * key (a project-scoped, ingest-only ApiKey with `ingestSourceType` set). The
 * receiver mutates the parsed OTLP request in-place to overwrite a fixed set of
 * resource attributes on every resource, so a malicious upstream payload can
 * never forge a different source / key / org identity onto its own traces:
 *
 *   - langwatch.source         (ingestSourceType — drives the /me/traces filter)
 *   - langwatch.api_key.id      (the ingestion key id)
 *   - langwatch.origin          ("ingest_key") — discriminator that the
 *                               governance content-strip / no-spy policy is
 *                               applicable (must be in GOVERNED_ORIGINS).
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
}

export const PROVENANCE_ATTR_SOURCE = "langwatch.source" as const;
export const PROVENANCE_ATTR_API_KEY_ID = "langwatch.api_key.id" as const;
export const PROVENANCE_ATTR_ORIGIN = "langwatch.origin" as const;
export const PROVENANCE_ATTR_ORGANIZATION_ID =
  "langwatch.organization_id" as const;
export const PROVENANCE_ATTR_TEMPLATE_ID = "langwatch.template.id" as const;

/**
 * Origin value stamped on ingest-key traces. Must be present in the
 * GOVERNED_ORIGINS set in GovernanceContentStripService, otherwise ingest-key
 * traces silently bypass the org's no-spy / strip-IO policy.
 */
export const INGEST_KEY_ORIGIN_VALUE = "ingest_key" as const;

const PROVENANCE_KEYS: readonly string[] = [
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_API_KEY_ID,
  PROVENANCE_ATTR_ORIGIN,
  PROVENANCE_ATTR_ORGANIZATION_ID,
  PROVENANCE_ATTR_TEMPLATE_ID,
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

function buildProvenanceAttributes(
  provenance: IngestKeyProvenance,
): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [
    { key: PROVENANCE_ATTR_SOURCE, value: { stringValue: provenance.sourceType } },
    { key: PROVENANCE_ATTR_API_KEY_ID, value: { stringValue: provenance.apiKeyId } },
    { key: PROVENANCE_ATTR_ORIGIN, value: { stringValue: INGEST_KEY_ORIGIN_VALUE } },
    { key: PROVENANCE_ATTR_ORGANIZATION_ID, value: { stringValue: provenance.organizationId } },
  ];
  if (provenance.templateId) {
    attrs.push({
      key: PROVENANCE_ATTR_TEMPLATE_ID,
      value: { stringValue: provenance.templateId },
    });
  }
  return attrs;
}

function stripProvenanceKeys(attrs: OtlpAttribute[]): OtlpAttribute[] {
  return attrs.filter((a) => !PROVENANCE_KEYS.includes(a.key));
}
