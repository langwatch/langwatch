import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api-key:last-used");

/** How long one recorded use of a key stands in for every later one. */
export const API_KEY_LAST_USED_WINDOW_MS = 60_000;
/** Past this many held keys, expired holds are swept before the next one. */
const HOLD_SWEEP_THRESHOLD = 10_000;

/**
 * At most one lastUsedAt write per key per window in this process. Process
 * state, not per instance: ApiKeyService is built per request. A failed write
 * releases its hold so the next use retries.
 */
export class ApiKeyLastUsedRecorder {
  private readonly heldUntil = new Map<string, number>();
  private readonly now: () => number;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.now = now;
  }

  /** Fire-and-forget: `write` runs only when the key is not already held. */
  markUsed({ id, write }: { id: string; write: () => Promise<unknown> }): void {
    const at = this.now();
    if (this.heldUntil.size >= HOLD_SWEEP_THRESHOLD) {
      this.sweepExpiredHolds(at);
    }
    if ((this.heldUntil.get(id) ?? 0) > at) return;

    const holdSetTo = at + API_KEY_LAST_USED_WINDOW_MS;
    this.heldUntil.set(id, holdSetTo);
    write().catch((err: unknown) => {
      if (this.heldUntil.get(id) === holdSetTo) this.heldUntil.delete(id);
      logger.warn(
        { err, apiKeyId: id },
        "failed to update API key lastUsedAt (fire-and-forget)",
      );
    });
  }

  private sweepExpiredHolds(at: number): void {
    for (const [id, until] of this.heldUntil) {
      if (until <= at) this.heldUntil.delete(id);
    }
  }
}

/** The one recorder every ApiKeyService in this process shares. */
export const processApiKeyLastUsed = new ApiKeyLastUsedRecorder();
