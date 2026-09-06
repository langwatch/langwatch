import type { ApiKeyService } from "@langwatch/api-key-contract";

import type { AgentSandboxKeySharePort } from "../ports/agent-sandbox-key-share.port";
import {
  PrismaApiKeyRepository,
  type PrismaApiKeyDatabase,
} from "../repositories/prisma/prisma.api-key.repository";
import { AgentSandboxKeyMintService } from "../services/agent-sandbox-key-mint.service";

/**
 * Postgres composition for the sandbox-key mint: the typed client goes straight
 * through to the repository the owner lookup reads, so nothing above knows a
 * repository exists and nothing below needs an untyped seam.
 */
export class PostgresAgentSandboxKeyMintAdapter {
  static create(options: {
    database: PrismaApiKeyDatabase;
    apiKeys: ApiKeyService;
    share: AgentSandboxKeySharePort;
  }): PostgresAgentSandboxKeyMintAdapter {
    return new PostgresAgentSandboxKeyMintAdapter(options);
  }

  private constructor(
    private readonly options: {
      database: PrismaApiKeyDatabase;
      apiKeys: ApiKeyService;
      share: AgentSandboxKeySharePort;
    },
  ) {}

  build(): AgentSandboxKeyMintService {
    return AgentSandboxKeyMintService.create({
      apiKeys: this.options.apiKeys,
      repository: PrismaApiKeyRepository.create(this.options.database),
      share: this.options.share,
    });
  }
}
