import {
  PrismaIngestionTemplateRepository,
  type IngestionTemplateDatabase,
} from "../repositories/prisma/prisma.ingestion-template.repository.ts";
import { IngestionTemplateService } from "../services/ingestion-template.service.ts";

export class PostgresIngestionTemplateAdapter {
  private constructor(
    private readonly database: IngestionTemplateDatabase,
    private readonly newSlugSuffix: (() => string) | undefined,
    private readonly now: (() => Date) | undefined,
  ) {}

  static create(options: {
    database: IngestionTemplateDatabase;
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
