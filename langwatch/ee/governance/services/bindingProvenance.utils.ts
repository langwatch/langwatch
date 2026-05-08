// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Receiver-side provenance stamping for traces landed via a
 * UserIngestionBinding. The receiver mutates the parsed OTLP request
 * in-place to overwrite three resource attributes on every resource:
 *
 *   - langwatch.template.id              (binding.templateId)
 *   - langwatch.user_ingestion_binding.id  (binding.id)
 *   - langwatch.source                   (template.slug — drives /me/traces filter)
 *
 * These are part of the closed `protectedTemplateAttributeKeys` set
 * (19 keys total — see template-ottl-principal-guard.feature). Stamping
 * happens AFTER the auth lookup but BEFORE the spans are forwarded to
 * the collector — even if a malicious upstream payload claimed values
 * for these keys, the receiver overwrite wins.
 *
 * For v1, OTTL transforms run as part of the upstream tool's exporter
 * (Claude Code / Cursor / claude_cowork are all already gen_ai-compliant)
 * and platform templates ship with empty ottlRules. The post-OTTL guard
 * shape is preserved here so v2 admin-OTTL authoring drops in without a
 * receiver refactor.
 *
 * Spec: specs/ai-gateway/governance/personal-project-ingest-via-template.feature
 *       specs/ai-gateway/governance/template-ottl-principal-guard.feature
 */

export interface BindingProvenance {
  bindingId: string;
  templateId: string;
  templateSlug: string;
}

export const PROVENANCE_ATTR_TEMPLATE_ID = "langwatch.template.id" as const;
export const PROVENANCE_ATTR_BINDING_ID =
  "langwatch.user_ingestion_binding.id" as const;
export const PROVENANCE_ATTR_SOURCE = "langwatch.source" as const;

const PROVENANCE_KEYS: readonly string[] = [
  PROVENANCE_ATTR_TEMPLATE_ID,
  PROVENANCE_ATTR_BINDING_ID,
  PROVENANCE_ATTR_SOURCE,
];

/**
 * OTLP/HTTP key/value attribute shape (proto JSON form). Mirrors the
 * minimal slice we need to mutate — no dependency on the full OTLP
 * proto types since we only touch resource attributes.
 */
type OtlpAttribute = {
  key: string;
  value: { stringValue?: string } & Record<string, unknown>;
};

type OtlpResource = { attributes?: OtlpAttribute[] | null };
type OtlpResourceSpans = { resource?: OtlpResource | null };
type OtlpTraceRequest = { resourceSpans?: OtlpResourceSpans[] | null };

/**
 * Mutates the trace request in-place so each resource's attributes
 * carry the binding's authoritative provenance. Existing attribute
 * values for the protected keys are REPLACED — same shape as the
 * principal-field guard pattern in services/aigateway/adapters/
 * ottlserver/principal_guard.go.
 *
 * Returns the count of resources stamped — useful for receiver
 * observability (admin can see "stamped 12 resources for binding X").
 */
export function stampBindingProvenanceOnTraceRequest(
  request: OtlpTraceRequest,
  provenance: BindingProvenance,
): number {
  if (!request.resourceSpans) return 0;
  let stamped = 0;
  for (const rs of request.resourceSpans) {
    if (!rs.resource) {
      rs.resource = { attributes: [] };
    }
    if (!rs.resource.attributes) {
      rs.resource.attributes = [];
    }
    rs.resource.attributes = stripProvenanceKeys(rs.resource.attributes);
    rs.resource.attributes.push(
      { key: PROVENANCE_ATTR_TEMPLATE_ID, value: { stringValue: provenance.templateId } },
      { key: PROVENANCE_ATTR_BINDING_ID, value: { stringValue: provenance.bindingId } },
      { key: PROVENANCE_ATTR_SOURCE, value: { stringValue: provenance.templateSlug } },
    );
    stamped++;
  }
  return stamped;
}

/**
 * OTLP logs share the resourceLogs shape — same provenance stamp.
 * Generic fold so we don't duplicate attribute-walking per signal type.
 */
type OtlpResourceLogs = { resource?: OtlpResource | null };
type OtlpLogRequest = { resourceLogs?: OtlpResourceLogs[] | null };

export function stampBindingProvenanceOnLogRequest(
  request: OtlpLogRequest,
  provenance: BindingProvenance,
): number {
  if (!request.resourceLogs) return 0;
  let stamped = 0;
  for (const rl of request.resourceLogs) {
    if (!rl.resource) {
      rl.resource = { attributes: [] };
    }
    if (!rl.resource.attributes) {
      rl.resource.attributes = [];
    }
    rl.resource.attributes = stripProvenanceKeys(rl.resource.attributes);
    rl.resource.attributes.push(
      { key: PROVENANCE_ATTR_TEMPLATE_ID, value: { stringValue: provenance.templateId } },
      { key: PROVENANCE_ATTR_BINDING_ID, value: { stringValue: provenance.bindingId } },
      { key: PROVENANCE_ATTR_SOURCE, value: { stringValue: provenance.templateSlug } },
    );
    stamped++;
  }
  return stamped;
}

function stripProvenanceKeys(attrs: OtlpAttribute[]): OtlpAttribute[] {
  return attrs.filter((a) => !PROVENANCE_KEYS.includes(a.key));
}
