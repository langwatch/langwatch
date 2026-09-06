import type { GovernanceOcsfEventsReaderPort } from "../ports/ocsf-export.port.ts";
import { PrismaGovernanceOcsfExportRepository } from "../repositories/prisma/prisma.ocsf-export.repository.ts";
import { DefaultGovernanceOcsfExportService } from "../services/ocsf-export.service.ts";

export class PostgresGovernanceOcsfExportAdapter {
  private constructor(
    private readonly database: object,
    private readonly events: GovernanceOcsfEventsReaderPort | undefined,
  ) {}

  static create(options: {
    database: object;
    events?: GovernanceOcsfEventsReaderPort;
  }): PostgresGovernanceOcsfExportAdapter {
    return new PostgresGovernanceOcsfExportAdapter(options.database, options.events);
  }

  build(): DefaultGovernanceOcsfExportService {
    return DefaultGovernanceOcsfExportService.create({
      repository: PrismaGovernanceOcsfExportRepository.create(this.database),
      events: this.events,
    });
  }
}
