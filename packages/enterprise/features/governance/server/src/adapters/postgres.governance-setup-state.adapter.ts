import type { GovernanceSetupActivityPort } from "../ports/governance-setup-state.port.ts";
import {
  PrismaGovernanceSetupStateRepository,
  type GovernanceSetupStateDatabase,
} from "../repositories/prisma/prisma.governance-setup-state.repository.ts";
import { DefaultGovernanceSetupStateService } from "../services/governance-setup-state.service.ts";

export class PostgresGovernanceSetupStateAdapter {
  private constructor(
    private readonly database: GovernanceSetupStateDatabase,
    private readonly activity: GovernanceSetupActivityPort | undefined,
  ) {}

  static create(options: {
    database: GovernanceSetupStateDatabase;
    activity?: GovernanceSetupActivityPort;
  }): PostgresGovernanceSetupStateAdapter {
    return new PostgresGovernanceSetupStateAdapter(options.database, options.activity);
  }

  build(): DefaultGovernanceSetupStateService {
    return DefaultGovernanceSetupStateService.create({
      repository: PrismaGovernanceSetupStateRepository.create(this.database),
      activity: this.activity,
    });
  }
}
