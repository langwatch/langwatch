import type { TraceDepartmentInput } from "@langwatch/enterprise-governance-contract";
import type { CostAttributionPolicyRepository } from "../repositories/cost-attribution-policy.repository";
import {
  NullGovernanceDiagnosticsPort,
  type GovernanceDiagnosticsPort,
} from "../ports/governance-diagnostics.port";
import { z } from "zod";

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
      diagnostics?: GovernanceDiagnosticsPort;
    } = {},
  ): PostgresGovernancePolicyService {
    return new PostgresGovernancePolicyService(repository, options);
  }

  private constructor(
    private readonly repository: CostAttributionPolicyRepository,
    private readonly options: {
      clock?: () => number;
      cacheTtlMs?: number;
      diagnostics?: GovernanceDiagnosticsPort;
    } = {},
  ) {}

  async resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    const key = `${input.organizationId}::${input.sourceType}`;
    const now = (this.options.clock ?? Date.now)();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.nonBillable;

    let nonBillable = true;
    try {
      const configs = await this.repository.enabledCodingAssistantConfigs(
        input.organizationId,
      );
      nonBillable = !configs.some((candidate) => {
        const parsed = codingAssistantConfigSchema.safeParse(candidate);
        return (
          parsed.success &&
          parsed.data.assistantKind === input.sourceType &&
          parsed.data.bundledPlan === false
        );
      });
    } catch (error) {
      const diagnostics = this.options.diagnostics ?? new NullGovernanceDiagnosticsPort();
      diagnostics.warn(
        "failed to resolve bundled-plan policy; defaulting to non-billable",
        {
          error,
          organizationId: input.organizationId,
          sourceType: input.sourceType,
        },
      );
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
