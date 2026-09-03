import { AGENT_SANDBOX_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

import type { ApiKeyRepository } from "../repositories/api-key.repository";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * Retires the credentials code agent runs left behind.
 *
 * A sandbox key is minted per run and has no counterpart at the end of one, so
 * this sweep is the only thing that revokes an elapsed key. It runs cross-tenant
 * and by predicate rather than per run, which is what lets it cover the runs
 * that were SIGKILLed and the ones nobody thought to clean up.
 *
 * The reserved name is supplied HERE rather than by the caller or the
 * repository, and that placement is the whole safety property: the sweep holds
 * no organization, so the only thing standing between it and every customer key
 * in the product is which name it is allowed to match. A caller cannot widen it,
 * because there is no argument with which to ask.
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
   * Revokes every elapsed, unrevoked sandbox key and answers how many.
   *
   * The clock is read once, so the instant a key is compared against is the
   * instant it is stamped with — a sweep that read the clock twice could revoke
   * a key as of a time it was still valid.
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
