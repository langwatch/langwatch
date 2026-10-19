import { generate } from "@langwatch/ksuid";
import type { WebPushSubscription } from "@langwatch/notification-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type {
  WebPushSubscriptionRepository,
  WebPushSubscriptionWrite,
} from "../web-push-subscription.repository.ts";

export class MemoryWebPushSubscriptionRepository implements WebPushSubscriptionRepository {
  #byEndpoint = new Map<string, WebPushSubscription>();

  private constructor() {}

  static create(): MemoryWebPushSubscriptionRepository {
    return new MemoryWebPushSubscriptionRepository();
  }

  async upsert(input: WebPushSubscriptionWrite): Promise<WebPushSubscription> {
    const existing = this.#byEndpoint.get(input.endpoint);
    const row: WebPushSubscription = {
      id: existing?.id ?? generate("webpushsub").toString(),
      createdAt: existing?.createdAt ?? toDate(nowInstant()),
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      ...input,
    };
    this.#byEndpoint.set(input.endpoint, row);
    return structuredClone(row);
  }

  async findById(id: string): Promise<WebPushSubscription | null> {
    const row = [...this.#byEndpoint.values()].find((candidate) => candidate.id === id);
    return row ? structuredClone(row) : null;
  }

  async findByUser(userId: string): Promise<WebPushSubscription[]> {
    return [...this.#byEndpoint.values()]
      .filter((row) => row.userId === userId)
      .map((row) => structuredClone(row));
  }

  async deleteForUser({ userId, endpoint }: { userId: string; endpoint: string }): Promise<void> {
    if (this.#byEndpoint.get(endpoint)?.userId === userId) this.#byEndpoint.delete(endpoint);
  }

  async deleteById(id: string): Promise<void> {
    for (const [endpoint, row] of this.#byEndpoint) {
      if (row.id === id) this.#byEndpoint.delete(endpoint);
    }
  }

  async deleteAllForUser(userId: string): Promise<number> {
    let removed = 0;
    for (const [endpoint, row] of this.#byEndpoint) {
      if (row.userId !== userId) continue;
      this.#byEndpoint.delete(endpoint);
      removed += 1;
    }
    return removed;
  }

  async recordSuccess({ id, at }: { id: string; at: Instant }): Promise<void> {
    for (const row of this.#byEndpoint.values()) {
      if (row.id === id) row.lastSuccessAt = toDate(at);
    }
  }
}
