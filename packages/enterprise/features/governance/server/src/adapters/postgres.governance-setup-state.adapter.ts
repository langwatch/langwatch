import type { GovernanceSetupActivityPort } from "../ports/governance-setup-state.port";
import { PrismaGovernanceSetupStateRepository } from "../repositories/prisma/prisma.governance-setup-state.repository";
import { GovernanceSetupStateService } from "../services/governance-setup-state.service";

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

  build(): GovernanceSetupStateService {
    return GovernanceSetupStateService.create({
      repository: PrismaGovernanceSetupStateRepository.create(this.database),
      activity: this.activity,
    });
  }
}
