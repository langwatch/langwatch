import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
  TraceDepartmentInput,
} from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import type { GovernanceDiagnosticsSink } from "../app/governance.members.ts";
import { silentGovernanceDiagnostics } from "../app/governance.members.ts";
import type { CostAttributionPolicyRepository } from "../repositories/cost-attribution-policy.repository.ts";
import { buildIngestKeyReceiverPolicies } from "../rules/ingest-key-provenance.rules.ts";

const UNASSIGNED_DEPARTMENT = "unassigned";
const codingAssistantConfigSchema = z.looseObject({
  assistantKind: z.string(),
  bundledPlan: z.boolean(),
});

export class PostgresGovernancePolicyService {
  private readonly cache = new Map<string, { nonBillable: boolean; expiresAt: number }>();

  static create(
    repository: CostAttributionPolicyRepository,
    options: {
      clock?: () => number;
      cacheTtlMs?: number;
      diagnostics?: GovernanceDiagnosticsSink;
    } = {},
  ): PostgresGovernancePolicyService {
    return new PostgresGovernancePolicyService(repository, options);
  }

  private constructor(
    private readonly repository: CostAttributionPolicyRepository,
    private readonly options: {
      clock?: () => number;
      cacheTtlMs?: number;
      diagnostics?: GovernanceDiagnosticsSink;
    } = {},
  ) {}

  async resolveOtlpReceiverPolicies(
    input: GovernanceOtlpPolicyInput,
  ): Promise<GovernanceOtlpReceiverPolicies> {
    const nonBillable = await this.resolveSourceNonBillable(input);
    return buildIngestKeyReceiverPolicies(input, nonBillable);
  }

  async resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    const key = `${input.organizationId}::${input.sourceType}`;
    const now = (this.options.clock ?? Date.now)();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.nonBillable;
    }

    let nonBillable = true;
    try {
      const configs = await this.repository.enabledCodingAssistantConfigs(input.organizationId);
      nonBillable = !configs.some((candidate) => {
        const parsed = codingAssistantConfigSchema.safeParse(candidate);

        return (
          parsed.success &&
          parsed.data.assistantKind === input.sourceType &&
          parsed.data.bundledPlan === false
        );
      });
    } catch (error) {
      const diagnostics = this.options.diagnostics ?? silentGovernanceDiagnostics;
      diagnostics.warn("failed to resolve bundled-plan policy; defaulting to non-billable", {
        error,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
      });
    }

    this.cache.set(key, {
      nonBillable,
      expiresAt: now + (this.options.cacheTtlMs ?? 30_000),
    });

    return nonBillable;
  }

  resolveTraceDepartment(input: TraceDepartmentInput): string {
    if (input.hasPrincipalUser) {
      return (
        input.userDepartmentId ||
        input.userTeamDepartmentId ||
        input.projectDepartmentId ||
        UNASSIGNED_DEPARTMENT
      );
    }

    return input.projectDepartmentId || UNASSIGNED_DEPARTMENT;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
