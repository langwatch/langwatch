import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import { PrismaCostAttributionPolicyRepository } from "../repositories/prisma/prisma.cost-attribution-policy.repository";
import { PostgresGovernancePolicyService } from "../services/governance-policy.service";

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
  diagnostics?: GovernanceDiagnosticsPort;
  clock?: () => number;
  cacheTtlMs?: number;
};

export type PostgresGovernanceServices = {
  policy: PostgresGovernancePolicyService;
};

/** Public composition seam; persistence repositories stay private. */
export class PostgresGovernanceAdapter {
  private constructor(private readonly options: PostgresGovernanceAdapterOptions) {}

  static create(options: PostgresGovernanceAdapterOptions): PostgresGovernanceAdapter {
    return new PostgresGovernanceAdapter(options);
  }

  build(): PostgresGovernanceServices {
    const repository = PrismaCostAttributionPolicyRepository.create(
      this.options.database,
    );
    return {
      policy: PostgresGovernancePolicyService.create(repository, {
        diagnostics: this.options.diagnostics,
        clock: this.options.clock,
        cacheTtlMs: this.options.cacheTtlMs,
      }),
    };
  }
}
