import type { OtlpReceiverPolicy } from "@langwatch/otlp";

export interface GovernanceOtlpPolicyInput {
  organizationId: string;
  sourceType: string;
  templateId?: string | null;
}

export interface GovernanceOtlpReceiverPolicies {
  traces: OtlpReceiverPolicy;
  logs: OtlpReceiverPolicy;
  metrics: OtlpReceiverPolicy;
}
