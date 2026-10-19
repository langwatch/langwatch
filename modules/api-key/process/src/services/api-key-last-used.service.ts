import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";

const logger = createLogger("langwatch:api-key:last-used");
export const API_KEY_LAST_USED_WINDOW_MS = 60_000;
/** The most keys held at once; past it the oldest hold goes, costing that key one early write. */
export const API_KEY_LAST_USED_MAX_HOLDS = 10_000;
/** Expired holds dropped per use: more than the one a use adds, so the map shrinks as use falls. */
const EXPIRED_HOLDS_DROPPED_PER_USE = 2;

/** Records a key's last use without turning every authenticated request into a Postgres write. */
export class ApiKeyLastUsedService {
  /** In the order each hold was set, so the oldest, and the first to expire, is at the front. */
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

  /** Fire-and-forget: at most one write per key per window in this process, O(1) per use. */
  markUsed({ id }: { id: string }): void {
    const at = this.now().epochMilliseconds;
    this.dropExpiredHolds(at);

    if ((this.heldUntil.get(id) ?? 0) > at) {
      return;
    }

    const holdSetTo = at + API_KEY_LAST_USED_WINDOW_MS;
    this.heldUntil.delete(id);
    if (this.heldUntil.size >= API_KEY_LAST_USED_MAX_HOLDS) {
      this.dropOldestHold();
    }
    this.heldUntil.set(id, holdSetTo);
    void this.repository.updateLastUsedAt({ id }).catch((error: unknown) => {
      if (this.heldUntil.get(id) === holdSetTo) {
        this.heldUntil.delete(id);
      }

      logger.warn({ error, apiKeyId: id }, "recording the key's last use failed, non-fatal");
    });
  }

  private dropExpiredHolds(at: number): void {
    for (let dropped = 0; dropped < EXPIRED_HOLDS_DROPPED_PER_USE; dropped++) {
      const oldest = this.heldUntil.entries().next();
      if (oldest.done || oldest.value[1] > at) {
        return;
      }

      this.heldUntil.delete(oldest.value[0]);
    }
  }

  private dropOldestHold(): void {
    const oldest = this.heldUntil.keys().next();
    if (!oldest.done) {
      this.heldUntil.delete(oldest.value);
    }
  }
}
