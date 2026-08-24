// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  isOttlEnabledSourceType,
  NON_ENTERPRISE_INGESTION_SOURCE_CAP,
  type GovernanceSourceType,
} from "@langwatch/enterprise-governance-contract";

export { isOttlEnabledSourceType, NON_ENTERPRISE_INGESTION_SOURCE_CAP };

/**
 * The single catalog of ingestion-source types the governance UI offers:
 * label, vendor mark, delivery mode, and the customer-facing group each type
 * sits under. The Add source menu, the composer, and the configured-source
 * list all read from here, so the offer can never drift between surfaces.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

export type SourceType = GovernanceSourceType;

export type SourceMode = "push" | "pull" | "s3";

/**
 * The two groups a customer reads. `mode` stays the internal delivery truth
 * (adapters and endpoints care about push vs pull vs s3); the group is the
 * plain-language fold of it: events either arrive on their own or LangWatch
 * goes and gets them. S3 drops are fetched on a cadence too, so they sit
 * with the scheduled group rather than earning a third technical heading.
 */
export type SourceGroup = "realtime" | "scheduled";

export const SOURCE_GROUP_META: Record<
  SourceGroup,
  { title: string; blurb: string }
> = {
  realtime: {
    title: "Real-time streams",
    blurb: "These platforms send events to LangWatch as they happen.",
  },
  scheduled: {
    title: "Synced on a schedule",
    blurb:
      "LangWatch fetches new activity from these platforms on a regular cadence, including audit files dropped in cloud storage.",
  },
};

export function groupForMode(mode: SourceMode): SourceGroup {
  return mode === "push" ? "realtime" : "scheduled";
}

export interface SourceTypeOption {
  value: SourceType;
  label: string;
  mode: SourceMode;
  blurb: string;
}

// `satisfies` (not a type annotation) so each entry's `value` keeps its
// literal type — the completeness guard below needs the narrow union.
export const SOURCE_TYPE_OPTIONS = [
  {
    value: "otel_generic",
    label: "Generic OpenTelemetry",
    mode: "push",
    blurb:
      "Anything that speaks OTLP/HTTP. Simplest setup - paste an OTLP URL + bearer token into the upstream agent's exporter config.",
  },
  {
    value: "claude_code",
    label: "Claude Code (Anthropic OAuth)",
    mode: "push",
    blurb:
      "Native OTLP from Anthropic's Claude Code (the standalone CLI authed against an OAuth seat - distinct from the Cowork workspace path). Cost lands as a first-class signal via the claude_code.cost.usage metric + per-request claude_code.api_request events; no token-catalog lookup needed. Admins paste the bare endpoint into Claude Code's OTEL_EXPORTER_OTLP_ENDPOINT and the SDK suffixes /v1/logs and /v1/metrics itself.",
  },
  {
    value: "claude_cowork",
    label: "Anthropic Claude (Cowork)",
    mode: "push",
    blurb:
      "Claude Cowork pushes telemetry via OTLP. Configure under Anthropic Admin Console → Cowork → Telemetry.",
  },
  {
    value: "workato",
    label: "Workato",
    mode: "push",
    blurb:
      "Workato pushes job-completed webhooks. Generate an HMAC shared secret, paste into Workato → Connection Profile → Webhook destination.",
  },
  {
    value: "copilot_studio",
    label: "Microsoft Copilot Studio (Purview)",
    mode: "pull",
    blurb:
      "Polls Microsoft Purview Audit API for Copilot Studio activity. Needs an Azure AD app registration with `AuditLog.Read.All` permission.",
  },
  {
    value: "openai_compliance",
    label: "OpenAI Enterprise Compliance",
    mode: "s3",
    blurb:
      "Pulls compliance JSONL drops from an S3 bucket OpenAI writes to (Enterprise Compliance API).",
  },
  {
    value: "claude_compliance",
    label: "Anthropic Claude Enterprise Compliance",
    mode: "pull",
    blurb: "Polls Anthropic's compliance API with a workspace API key.",
  },
  {
    value: "anthropic_admin",
    label: "Anthropic Admin API (usage & cost)",
    mode: "pull",
    blurb:
      "Polls Anthropic's organization usage/cost reports with an Admin API key (sk-ant-admin-...). Pick ONE report per source: usage (token counts, we price them) or cost (Anthropic's reported spend, excludes Priority Tier). Never create both for the same org — the same spend would be counted twice.",
  },
  {
    value: "databricks_genie",
    label: "Databricks AI/BI Genie",
    mode: "pull",
    blurb:
      "Records who asked what in Genie and the SQL it ran against your warehouse. Sign in with a Databricks service principal holding Can Manage on every Genie space you want covered — anything less returns only its own conversations.",
  },
  {
    value: "s3_custom",
    label: "Custom S3 audit log",
    mode: "s3",
    blurb:
      "For homegrown agent systems writing audit logs to S3. Provide a parser DSL describing how each line maps to OCSF ActivityEvent fields.",
  },
  {
    value: "http_custom",
    label: "Custom HTTP audit-log API",
    mode: "pull",
    blurb:
      "Bring-your-own paginated REST audit-log API. Declare URL + auth + cursor + JSON-path field mappings; the universal HTTP-polling adapter handles paging + retries + OCSF fold.",
  },
] satisfies SourceTypeOption[];

// Compile-time completeness guard: if the server grows a source type the
// catalog doesn't offer, this line stops building. The runtime cast in
// SOURCE_TYPE_LABEL below is only sound because of it.
type UncataloguedSourceType = Exclude<
  SourceType,
  (typeof SOURCE_TYPE_OPTIONS)[number]["value"]
>;
const _catalogIsComplete: UncataloguedSourceType extends never ? true : never =
  true;
void _catalogIsComplete;

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = Object.fromEntries(
  SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SourceType, string>;

export interface GatedSourceTypeOption extends SourceTypeOption {
  /** Locked types render in the menu but cannot be picked. */
  locked: boolean;
}

/**
 * The one plan gate. Non-enterprise plans may only create Generic
 * OpenTelemetry sources; every other type stays visible so the menu can say
 * what an Enterprise plan unlocks, but is inert. The Add source menu is the
 * only surface that reads this list, and the composer is only reachable
 * through the menu's onPick — so this one gate covers both. Never re-filter
 * SOURCE_TYPE_OPTIONS at a callsite, or a locked type leaks through.
 */
export function gatedSourceTypeOptions({
  isEnterprise,
}: {
  isEnterprise: boolean;
}): GatedSourceTypeOption[] {
  return SOURCE_TYPE_OPTIONS.map((option) => ({
    ...option,
    locked: !isEnterprise && option.value !== "otel_generic",
  }));
}
