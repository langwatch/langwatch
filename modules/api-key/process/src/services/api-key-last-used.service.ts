import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";

const logger = createLogger("langwatch:api-key:last-used");
export const API_KEY_LAST_USED_WINDOW_MS = 60_000;
const HOLD_SWEEP_THRESHOLD = 10_000;

/** Records a key's last use without turning every authenticated request into a Postgres write. */
export class ApiKeyLastUsedService {
  private readonly heldUntil = new Map<string, number>();

  private constructor(
    private readonly repository: Pick<ApiKeyRepository, "updateLastUsedAt">,
    private readonly now: () => Instant,
  ) {}

  static create(options: {
    repository: Pick<ApiKeyRepository, "updateLastUsedAt">;
    now?: () => Instant;
  }): ApiKeyLastUsedService {
    return new ApiKeyLastUsedService(options.repository, options.now ?? nowInstant);
  }

  /** Fire-and-forget: at most one write per key per window in this process. */
  markUsed({ id }: { id: string }): void {
    const at = this.now().epochMilliseconds;
    if (this.heldUntil.size >= HOLD_SWEEP_THRESHOLD) {
      this.sweepExpiredHolds(at);
    }

    if ((this.heldUntil.get(id) ?? 0) > at) {
      return;
    }

    const holdSetTo = at + API_KEY_LAST_USED_WINDOW_MS;
    this.heldUntil.set(id, holdSetTo);
    void this.repository.updateLastUsedAt({ id }).catch((error: unknown) => {
      if (this.heldUntil.get(id) === holdSetTo) {
        this.heldUntil.delete(id);
      }

      logger.warn({ error, apiKeyId: id }, "recording the key's last use failed, non-fatal");
    });
  }

  private sweepExpiredHolds(at: number): void {
    for (const [id, until] of this.heldUntil) {
      if (until <= at) {
        this.heldUntil.delete(id);
      }
    }
  }
}
