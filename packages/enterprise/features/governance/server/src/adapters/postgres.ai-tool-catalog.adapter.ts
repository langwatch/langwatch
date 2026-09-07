import type { AiToolProviderCatalogPort, AiToolSlugPort } from "../ports/ai-tool-catalog.port.ts";
import {
  PrismaAiToolCatalogRepository,
  type AiToolCatalogDatabase,
} from "../repositories/prisma/prisma.ai-tool-catalog.repository.ts";
import { DefaultGovernanceAiToolCatalogService } from "../services/ai-tool-catalog.service.ts";

export class PostgresAiToolCatalogAdapter {
  private constructor(
    private readonly options: {
      database: AiToolCatalogDatabase;
      slugs: AiToolSlugPort;
      providers: AiToolProviderCatalogPort;
    },
  ) {}

  static create(options: {
    database: AiToolCatalogDatabase;
    slugs: AiToolSlugPort;
    providers: AiToolProviderCatalogPort;
  }): PostgresAiToolCatalogAdapter {
    return new PostgresAiToolCatalogAdapter(options);
  }

  build(): DefaultGovernanceAiToolCatalogService {
    return DefaultGovernanceAiToolCatalogService.create({
      repository: PrismaAiToolCatalogRepository.create(this.options.database),
      slugs: this.options.slugs,
      providers: this.options.providers,
    });
  }
}
