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
 *   - langwatch.origin          ("coding_agent" for a CLI coding assistant,
 *                               "ai_tool" for any other ingest source) —
 *                               discriminator the governance content-strip /
 *                               no-spy policy keys on (must be in
 *                               GOVERNED_ORIGINS).
 *   - langwatch.organization_id (feeds the no-spy policy org lookup)
 *   - langwatch.template.id     (only when the key carries an ingestionTemplateId,
 *                               e.g. claude_cowork)
 *
 * `langwatch.api_key.id` is handled separately, by
 * {@link enforceApiKeyIdOnTraceRequest} and its log / metric siblings, because
 * it is NOT conditional on the key being an ingestion key. Every authenticated
 * OTLP request gets that attribute rewritten from the authenticated identity,
 * which is what makes the redaction deny-list exemption on that exact name safe
 * (see applyContentRedaction.ts).
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
/**
 * Id of the ApiKey row that authenticated the request. Receiver-written on
 * every authenticated OTLP request, never trusted from the payload.
 */
export const PROVENANCE_ATTR_API_KEY_ID = "langwatch.api_key.id" as const;
export const PROVENANCE_ATTR_ORIGIN = "langwatch.origin" as const;
export const PROVENANCE_ATTR_ORGANIZATION_ID = "langwatch.organization_id" as const;
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
  // The three copilot capture surfaces (ADR-039): CLI wrapper, standalone
  // app login agent, VS Code Copilot Chat. Without these, copilot traces
  // surface as origin=ai_tool and drop out of coding-agent filters.
  "copilot_cli",
  "copilot_app",
  "copilot_vscode",
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
type OtlpAttributeHolder = { attributes?: OtlpAttribute[] | null };
type OtlpSpanLike = OtlpAttributeHolder & {
  events?: OtlpAttributeHolder[] | null;
  links?: OtlpAttributeHolder[] | null;
};
type OtlpScope = { name?: string | null } | null;
type OtlpScopeSpans = { scope?: OtlpScope; spans?: OtlpSpanLike[] | null };
type OtlpResourceSpans = {
  resource?: OtlpResource | null;
  scopeSpans?: OtlpScopeSpans[] | null;
};
type OtlpTraceRequest = { resourceSpans?: OtlpResourceSpans[] | null };
type OtlpScopeLogs = { logRecords?: OtlpAttributeHolder[] | null };
type OtlpResourceLogs = {
  resource?: OtlpResource | null;
  scopeLogs?: OtlpScopeLogs[] | null;
};
type OtlpLogRequest = { resourceLogs?: OtlpResourceLogs[] | null };
type OtlpMetricLike = OtlpAttributeHolder;
type OtlpScopeMetrics = {
  scope?: OtlpScope;
  metrics?: OtlpMetricLike[] | null;
};
type OtlpResourceMetrics = {
  resource?: OtlpResource | null;
  scopeMetrics?: OtlpScopeMetrics[] | null;
};
type OtlpMetricRequest = { resourceMetrics?: OtlpResourceMetrics[] | null };

/**
 * Instrumentation scopes a `copilot_vscode` ingest key may carry. The `code`
 * wrapper injects SPEC-STANDARD `OTEL_*` env into the whole VS Code process;
 * `terminal.integrated.env` clears it from integrated terminals, but VS Code's
 * js-debug internal console and extension-spawned processes still inherit it.
 * A developer F5-debugging their own OTel-instrumented service would POST that
 * service's traces here under the copilot key, labelled copilot-chat, into
 * governance analytics. Scope-gate the key: only Copilot's own scopes pass.
 */
export const COPILOT_VSCODE_ALLOWED_SCOPES: ReadonlySet<string> = new Set([
  "github.copilot",
  "@github/copilot",
]);

/**
 * Drop scope-spans (or scope-metrics) whose instrumentation scope is not
 * Copilot's when the ingest key is `copilot_vscode`. Returns the number of
 * scope groups dropped (0 for every other sourceType — no-op).
 */
function scopeAllowedForVscode(scope: OtlpScope | undefined): boolean {
  return COPILOT_VSCODE_ALLOWED_SCOPES.has(scope?.name ?? "");
}

/** Filter one resource group's scope list in place; returns how many dropped. */
function dropForeignFromGroups<T extends { scope?: OtlpScope }>(
  groups: T[] | null | undefined,
): { kept: T[]; dropped: number } {
  const all = groups ?? [];
  const kept = all.filter((g) => scopeAllowedForVscode(g.scope));
  return { kept, dropped: all.length - kept.length };
}

export function dropForeignScopesForVscodeKey(
  request: OtlpTraceRequest & OtlpMetricRequest,
  sourceType: string,
): number {
  if (sourceType !== "copilot_vscode") return 0;
  let dropped = 0;
  if (request.resourceSpans) {
    for (const rs of request.resourceSpans) {
      const r = dropForeignFromGroups(rs.scopeSpans);
      rs.scopeSpans = r.kept;
      dropped += r.dropped;
    }
    request.resourceSpans = request.resourceSpans.filter((rs) => (rs.scopeSpans?.length ?? 0) > 0);
  }
  if (request.resourceMetrics) {
    for (const rm of request.resourceMetrics) {
      const r = dropForeignFromGroups(rm.scopeMetrics);
      rm.scopeMetrics = r.kept;
      dropped += r.dropped;
    }
    request.resourceMetrics = request.resourceMetrics.filter(
      (rm) => (rm.scopeMetrics?.length ?? 0) > 0,
    );
  }
  return dropped;
}

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

function buildProvenanceAttributes(provenance: IngestKeyProvenance): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [
    {
      key: PROVENANCE_ATTR_SOURCE,
      value: { stringValue: provenance.sourceType },
    },
    {
      key: PROVENANCE_ATTR_ORIGIN,
      value: { stringValue: originForIngestSourceType(provenance.sourceType) },
    },
    {
      key: PROVENANCE_ATTR_ORGANIZATION_ID,
      value: { stringValue: provenance.organizationId },
    },
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

/**
 * Rewrite `langwatch.api_key.id` from the authenticated identity, on every
 * authenticated OTLP request rather than only on ingest-key traffic.
 *
 * THIS IS A SECURITY INVARIANT, not a convenience. `redactAttributeNative`
 * exempts this exact name from the sensitive-attribute-NAME deny-list so the id
 * stays readable instead of rendering as [SECRET]. That exemption is only sound
 * while the stored value cannot come from the payload: an attribute name is
 * caller-supplied, so a name the deny-list skips would otherwise be a free slot
 * to park a real secret in and have it stored verbatim.
 *
 * So the rule here is total, and deliberately has no "authenticated enough"
 * branch:
 *
 *   - Any payload-supplied copy of the attribute is dropped first, at every
 *     level a caller can reach: resource, span, span event and span link. It is
 *     resource-level provenance, so a span-level copy is never legitimate.
 *   - When the request authenticated as an ApiKey, the true row id is written
 *     onto each resource.
 *   - When it authenticated as something with no ApiKey row behind it (a legacy
 *     project key, or an ingestion-source bearer secret on the
 *     /api/ingest/otel/* passthroughs) nothing is written and the attribute
 *     simply stays absent. Absent is a correct answer; a caller-supplied value
 *     is not.
 *
 * Only the OTLP receivers need this, because they are the only ingestion paths
 * where the caller chooses attribute names. Everything else builds attributes
 * from a fixed key set (the REST collector maps known fields through
 * `ATTR_KEYS` and stringifies `params` into one attribute; caller metadata
 * lands namespaced under `langwatch.metadata.*`), so no caller can produce this
 * attribute name there at all.
 */
export function enforceApiKeyIdOnTraceRequest(
  request: OtlpTraceRequest,
  apiKeyId: string | null,
): number {
  let applied = 0;
  for (const rs of request.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        dropApiKeyIdFromSpan(span);
      }
    }
    applied += writeApiKeyIdOnResource(rs, apiKeyId);
  }
  return applied;
}

export function enforceApiKeyIdOnLogRequest(
  request: OtlpLogRequest,
  apiKeyId: string | null,
): number {
  let applied = 0;
  for (const rl of request.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
        dropApiKeyId(record);
      }
    }
    applied += writeApiKeyIdOnResource(rl, apiKeyId);
  }
  return applied;
}

export function enforceApiKeyIdOnMetricRequest(
  request: OtlpMetricRequest,
  apiKeyId: string | null,
): number {
  let applied = 0;
  for (const rm of request.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        dropApiKeyId(metric);
      }
    }
    applied += writeApiKeyIdOnResource(rm, apiKeyId);
  }
  return applied;
}

function writeApiKeyIdOnResource(
  holder: { resource?: OtlpResource | null },
  apiKeyId: string | null,
): number {
  if (!holder.resource) holder.resource = { attributes: [] };
  if (!holder.resource.attributes) holder.resource.attributes = [];
  dropApiKeyId(holder.resource);
  if (apiKeyId === null) return 0;
  holder.resource.attributes.push({
    key: PROVENANCE_ATTR_API_KEY_ID,
    value: { stringValue: apiKeyId },
  });
  return 1;
}

function dropApiKeyId(holder: OtlpAttributeHolder): void {
  if (!holder.attributes) return;
  holder.attributes = holder.attributes.filter((a) => a.key !== PROVENANCE_ATTR_API_KEY_ID);
}

function dropApiKeyIdFromSpan(span: OtlpSpanLike): void {
  dropApiKeyId(span);
  for (const event of span.events ?? []) dropApiKeyId(event);
  for (const link of span.links ?? []) dropApiKeyId(link);
}
