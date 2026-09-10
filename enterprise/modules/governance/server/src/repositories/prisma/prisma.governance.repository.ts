import type { GovernanceDiagnosticsSink } from "../../app/governance.members.ts";
import { PrismaCostAttributionPolicyRepository } from "./prisma.cost-attribution-policy.repository.ts";
import { PostgresGovernancePolicyService } from "../../services/governance-policy.service.ts";

export type GovernanceDatabase = {
  aiToolEntry: {
    findMany(input: {
      where: {
        organizationId: string;
        type: "coding_assistant";
        enabled: true;
        archivedAt: null;
      };
      select: { config: true };
    }): Promise<Array<{ config: unknown }>>;
  };
};

export type PostgresGovernanceAdapterOptions = {
  database: GovernanceDatabase;
  diagnostics?: GovernanceDiagnosticsSink;
  clock?: () => number;
  cacheTtlMs?: number;
};

export type PostgresGovernanceServices = {
  policy: PostgresGovernancePolicyService;
};

/** Public composition seam; persistence repositories stay private. */
export class PrismaGovernanceRepository {
  private constructor(private readonly options: PostgresGovernanceAdapterOptions) {}

  static create(options: PostgresGovernanceAdapterOptions): PrismaGovernanceRepository {
    return new PrismaGovernanceRepository(options);
  }

  build(): PostgresGovernanceServices {
    const repository = PrismaCostAttributionPolicyRepository.create(this.options.database);
    return {
      policy: PostgresGovernancePolicyService.create(repository, {
        diagnostics: this.options.diagnostics,
        clock: this.options.clock,
        cacheTtlMs: this.options.cacheTtlMs,
      }),
    };
  }
}
