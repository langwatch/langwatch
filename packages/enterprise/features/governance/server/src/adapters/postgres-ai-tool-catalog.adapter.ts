import type {
  AiToolProviderCatalogPort,
  AiToolSlugPort,
} from "../ports/ai-tool-catalog.port";
import { PrismaAiToolCatalogRepository } from "../repositories/prisma/prisma-ai-tool-catalog.repository";
import { DefaultGovernanceAiToolCatalogService } from "../services/ai-tool-catalog.service";

export class PostgresAiToolCatalogAdapter {
  private constructor(
    private readonly options: {
      database: object;
      slugs: AiToolSlugPort;
      providers: AiToolProviderCatalogPort;
    },
  ) {}

  static create(options: {
    database: object;
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
