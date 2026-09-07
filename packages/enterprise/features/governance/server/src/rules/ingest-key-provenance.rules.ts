// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OtlpKeyValue, OtlpReceiverPolicy } from "@langwatch/otlp";
import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
} from "@langwatch/enterprise-governance-contract";

const CODING_AGENT_SOURCES = new Set([
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "copilot_cli",
  "copilot_app",
  "copilot_vscode",
]);
const COPILOT_SCOPES = ["github.copilot", "@github/copilot"];
const PROVENANCE_KEYS = [
  "langwatch.source",
  "langwatch.api_key.id",
  "langwatch.origin",
  "langwatch.organization_id",
  "langwatch.template.id",
  "langwatch.cost.non_billable",
];

export function originForIngestSourceType(sourceType: string): string {
  return CODING_AGENT_SOURCES.has(sourceType) ? "coding_agent" : "ai_tool";
}

/** Governance decides attribution; core OTLP only applies this declarative policy. */
export function buildIngestKeyReceiverPolicies(
  input: GovernanceOtlpPolicyInput,
  nonBillable: boolean,
): GovernanceOtlpReceiverPolicies {
  const attributes: OtlpKeyValue[] = [
    { key: "langwatch.source", value: { stringValue: input.sourceType } },
    {
      key: "langwatch.origin",
      value: { stringValue: originForIngestSourceType(input.sourceType) },
    },
    { key: "langwatch.organization_id", value: { stringValue: input.organizationId } },
  ];
  if (input.templateId) {
    attributes.push({ key: "langwatch.template.id", value: { stringValue: input.templateId } });
  }

  // VS Code children inherit OTEL_*; unrelated scopes must not count as Copilot activity.
  const scopes = input.sourceType === "copilot_vscode" ? COPILOT_SCOPES : void 0;
  const common: OtlpReceiverPolicy = {
    resourceAttributeKeysToRemove: PROVENANCE_KEYS,
    resourceAttributes: attributes,
    ...(scopes ? { allowedTraceScopeNames: scopes, allowedMetricScopeNames: scopes } : {}),
  };
  const priced: OtlpReceiverPolicy = {
    ...common,
    resourceAttributes: [
      ...attributes,
      { key: "langwatch.cost.non_billable", value: { stringValue: String(nonBillable) } },
    ],
  };

  return { traces: priced, logs: priced, metrics: common };
}
