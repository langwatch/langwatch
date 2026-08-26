import { PrismaIngestionTemplateRepository } from "../repositories/prisma/prisma-ingestion-template.repository";
import { IngestionTemplateService } from "../services/ingestion-template.service";

export class PostgresIngestionTemplateAdapter {
  private constructor(
    private readonly database: object,
    private readonly newSlugSuffix: (() => string) | undefined,
    private readonly now: (() => Date) | undefined,
  ) {}

  static create(options: {
    database: object;
    newSlugSuffix?: () => string;
    now?: () => Date;
  }): PostgresIngestionTemplateAdapter {
    return new PostgresIngestionTemplateAdapter(
      options.database,
      options.newSlugSuffix,
      options.now,
    );
  }

  build(): IngestionTemplateService {
    return IngestionTemplateService.create({
      repository: PrismaIngestionTemplateRepository.create(this.database),
      newSlugSuffix: this.newSlugSuffix,
      now: this.now,
    });
  }
}
