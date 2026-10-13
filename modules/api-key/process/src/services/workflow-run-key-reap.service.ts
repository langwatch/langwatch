import { WORKFLOW_RUN_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";

const logger = createLogger("langwatch:api-key:workflow-run");

/**
 * Retires the keys workflow runs left behind. A run key is minted for one run and lapses on its
 * own, so this sweep is the only thing that revokes an elapsed one.
 */
export class WorkflowRunKeyReapService {
  static create(options: {
    repository: ApiKeyRepository;
    now?: () => Instant;
  }): WorkflowRunKeyReapService {
    return new WorkflowRunKeyReapService(options.repository, options.now ?? nowInstant);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly now: () => Instant,
  ) {}

  /** Revokes every elapsed, unrevoked run key and answers how many; the clock is read once. */
  async reap(): Promise<number> {
    const now = this.now();
    const count = await this.repository.revokeExpiredByName({
      name: WORKFLOW_RUN_API_KEY_NAME,
      now,
      systemManagedOnly: true,
    });
    if (count > 0) {
      logger.info({ count }, "reaped expired workflow run keys");
    }

    return count;
  }
}
