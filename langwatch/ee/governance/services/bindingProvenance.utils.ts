// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Receiver-side provenance stamping for traces landed via a
 * UserIngestionBinding. The receiver mutates the parsed OTLP request
 * in-place to overwrite five resource attributes on every resource:
 *
 *   - langwatch.template.id                (binding.templateId)
 *   - langwatch.user_ingestion_binding.id  (binding.id)
 *   - langwatch.source                     (template.slug — drives /me/traces filter)
 *   - langwatch.origin                     ("user_ingestion_binding") — feeds the
 *                                          governance-content-strip pipeline; the
 *                                          strip service uses this as the
 *                                          discriminator that no-spy / strip-IO
 *                                          policy is applicable.
 *   - langwatch.organization_id            (binding.organizationId) — required by
 *                                          GovernanceContentStripService.governanceTargetOrgId
 *                                          to look up the org's content-mode
 *                                          policy. Without this stamp,
 *                                          binding-routed traces silently
 *                                          BYPASS the org's no-spy setting
 *                                          (compliance hole — gap #5 from the
 *                                          ralph-loop audit).
 *
 * Stamping happens AFTER the auth lookup but BEFORE the spans are forwarded
 * to the collector — even if a malicious upstream payload claimed values
 * for these keys, the receiver overwrite wins.
 *
 * Spec: specs/ai-gateway/governance/personal-project-ingest-via-template.feature
 *       specs/ai-gateway/governance/template-ottl-principal-guard.feature
 *       specs/ai-gateway/governance/no-spy-mode.feature (forthcoming, andre)
 */

export interface BindingProvenance {
  bindingId: string;
  /** Null for template-free coding-assistant bindings — when null the
   *  `langwatch.template.id` attr is omitted (nothing to stamp). */
  templateId: string | null;
  /** Canonical tool slug (e.g. `claude_code`) — always set; stamped as
   *  `langwatch.source`. Stable across template-existence, which is why
   *  it (not templateSlug) drives the source attr. */
  sourceType: string;
  /** Org id of the bound personal project — feeds the no-spy policy lookup. */
  organizationId: string;
}

export const PROVENANCE_ATTR_TEMPLATE_ID = "langwatch.template.id" as const;
export const PROVENANCE_ATTR_BINDING_ID =
  "langwatch.user_ingestion_binding.id" as const;
export const PROVENANCE_ATTR_SOURCE = "langwatch.source" as const;
export const PROVENANCE_ATTR_ORIGIN = "langwatch.origin" as const;
export const PROVENANCE_ATTR_ORGANIZATION_ID =
  "langwatch.organization_id" as const;

/**
 * Origin value stamped on binding-routed traces. Mirrors the
 * GOVERNED_ORIGINS set in GovernanceContentStripService — the strip
 * service's `governanceTargetOrgId` check accepts this value alongside
 * `gateway`, so binding-routed traces participate in the org's no-spy /
 * strip-IO policy. Naming chosen short ('binding') per MO directive +
 * matching the existing `gateway` literal in the same set.
 */
export const BINDING_ORIGIN_VALUE = "binding" as const;

const PROVENANCE_KEYS: readonly string[] = [
  PROVENANCE_ATTR_TEMPLATE_ID,
  PROVENANCE_ATTR_BINDING_ID,
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_ORIGIN,
  PROVENANCE_ATTR_ORGANIZATION_ID,
];

/**
 * OTLP/HTTP key/value attribute shape (proto JSON form). Mirrors the
 * minimal slice we need to mutate — no dependency on the full OTLP
 * proto types since we only touch resource attributes.
 */
type OtlpAttribute = {
  key: string;
  value: { stringValue?: string | null } & Record<string, unknown>;
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
    rs.resource.attributes.push(...buildProvenanceAttributes(provenance));
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
    rl.resource.attributes.push(...buildProvenanceAttributes(provenance));
    stamped++;
  }
  return stamped;
}

function buildProvenanceAttributes(
  provenance: BindingProvenance,
): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [
    { key: PROVENANCE_ATTR_BINDING_ID, value: { stringValue: provenance.bindingId } },
    // langwatch.source is the canonical tool slug; template-free bindings
    // still have a stable source even though they carry no template row.
    { key: PROVENANCE_ATTR_SOURCE, value: { stringValue: provenance.sourceType } },
    { key: PROVENANCE_ATTR_ORIGIN, value: { stringValue: BINDING_ORIGIN_VALUE } },
    { key: PROVENANCE_ATTR_ORGANIZATION_ID, value: { stringValue: provenance.organizationId } },
  ];
  // Only template-backed bindings (e.g. claude_cowork) carry a template id.
  if (provenance.templateId !== null) {
    attrs.unshift({
      key: PROVENANCE_ATTR_TEMPLATE_ID,
      value: { stringValue: provenance.templateId },
    });
  }
  return attrs;
}

function stripProvenanceKeys(attrs: OtlpAttribute[]): OtlpAttribute[] {
  return attrs.filter((a) => !PROVENANCE_KEYS.includes(a.key));
}
