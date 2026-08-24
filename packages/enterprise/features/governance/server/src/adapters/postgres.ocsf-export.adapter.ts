import type { GovernanceOcsfEventsReaderPort } from "../ports/ocsf-export.port";
import { PrismaGovernanceOcsfExportRepository } from "../repositories/prisma/prisma.ocsf-export.repository";
import { GovernanceOcsfExportService } from "../services/ocsf-export.service";

export class PostgresGovernanceOcsfExportAdapter {
  private constructor(
    private readonly database: object,
    private readonly events: GovernanceOcsfEventsReaderPort | undefined,
  ) {}

  static create(options: {
    database: object;
    events?: GovernanceOcsfEventsReaderPort;
  }): PostgresGovernanceOcsfExportAdapter {
    return new PostgresGovernanceOcsfExportAdapter(
      options.database,
      options.events,
    );
  }

  build(): GovernanceOcsfExportService {
    return GovernanceOcsfExportService.create({
      repository: PrismaGovernanceOcsfExportRepository.create(this.database),
      events: this.events,
    });
  }
}
