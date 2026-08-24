import type { GovernanceSetupActivityPort } from "../ports/governance-setup-state.port";
import { PrismaGovernanceSetupStateRepository } from "../repositories/prisma/prisma.governance-setup-state.repository";
import { DefaultGovernanceSetupStateService } from "../services/governance-setup-state.service";

export class PostgresGovernanceSetupStateAdapter {
  private constructor(
    private readonly database: object,
    private readonly activity: GovernanceSetupActivityPort | undefined,
  ) {}

  static create(options: {
    database: object;
    activity?: GovernanceSetupActivityPort;
  }): PostgresGovernanceSetupStateAdapter {
    return new PostgresGovernanceSetupStateAdapter(
      options.database,
      options.activity,
    );
  }

  build(): DefaultGovernanceSetupStateService {
    return DefaultGovernanceSetupStateService.create({
      repository: PrismaGovernanceSetupStateRepository.create(this.database),
      activity: this.activity,
    });
  }
}
