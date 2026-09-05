import { AGENT_SANDBOX_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

import type { ApiKeyRepository } from "../repositories/api-key.repository";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * Retires the credentials code agent runs left behind. A sandbox key is minted per run and has
 * no counterpart at the end of one, so this sweep is the only thing that revokes an elapsed
 * key.
 */
export class AgentSandboxKeyReapService {
  static create(options: {
    repository: ApiKeyRepository;
    now?: () => Date;
  }): AgentSandboxKeyReapService {
    return new AgentSandboxKeyReapService(options.repository, options.now ?? (() => new Date()));
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly now: () => Date,
  ) {}

  /**
   * Revokes every elapsed, unrevoked sandbox key and answers how many. The clock is read once,
   * so the instant a key is compared against is the instant it is stamped with — a sweep that
   * read the clock twice could revoke a key as of a time it was still valid.
   */
  async reap(): Promise<number> {
    const now = this.now();
    const count = await this.repository.revokeExpiredByName({
      name: AGENT_SANDBOX_API_KEY_NAME,
      now,
    });
    if (count > 0) {
      logger.info({ count }, "reaped expired agent sandbox keys");
    }

    return count;
  }
}
