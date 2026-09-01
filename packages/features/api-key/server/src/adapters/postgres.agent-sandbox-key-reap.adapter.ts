import {
  PrismaApiKeyRepository,
  type PrismaApiKeyDatabase,
} from "../repositories/prisma/prisma.api-key.repository";
import { AgentSandboxKeyReapService } from "../services/agent-sandbox-key-reap.service";

/**
 * The process's Prisma client, as the sweep receives it.
 *
 * The same database type the rest of this package's Postgres composition takes,
 * rather than a narrower one of its own: the sweep goes through the API-key
 * repository like every other write, and a second database shape here would
 * only mean a second repository saying the same thing about the same table.
 */
export type AgentSandboxKeyReapDatabase = PrismaApiKeyDatabase;

/**
 * Postgres composition for the agent-sandbox sweep.
 *
 * The composition root passes its typed client straight through to the
 * repository; nothing above this adapter knows a repository exists, and nothing
 * below it needs an untyped seam.
 */
export class PostgresAgentSandboxKeyReapAdapter {
  static create(options: {
    database: AgentSandboxKeyReapDatabase;
    now?: () => Date;
  }): PostgresAgentSandboxKeyReapAdapter {
    return new PostgresAgentSandboxKeyReapAdapter(options);
  }

  private constructor(
    private readonly options: {
      database: AgentSandboxKeyReapDatabase;
      now?: () => Date;
    },
  ) {}

  build(): AgentSandboxKeyReapService {
    return AgentSandboxKeyReapService.create({
      repository: PrismaApiKeyRepository.create(this.options.database),
      ...(this.options.now ? { now: this.options.now } : {}),
    });
  }
}
