import { generate } from "@langwatch/ksuid";
import { nowInstant, type Instant } from "@langwatch/time";

import { type WebhookId, type WebhookSecret } from "../../app/webhook.app.ts";
import type { WebhookRetentionRepository } from "../webhook-retention.repository.ts";
import type { WebhookRepositories } from "../webhook.repositories.ts";
import { MemoryWebhookDispatchCapRepository } from "./memory.webhook-dispatch-cap.repository.ts";
import { MemoryWebhookEndpointRepository } from "./memory.webhook-endpoint.repository.ts";
import { MemoryWebhookRateLimitRepository } from "./memory.webhook-rate-limit.repository.ts";
import { MemoryWebhookDatabase } from "./memory.webhook.database.ts";

class MemoryWebhookRetentionRepository implements WebhookRetentionRepository {
  private constructor(private readonly database: MemoryWebhookDatabase) {}

  static create(input: { database: MemoryWebhookDatabase }): MemoryWebhookRetentionRepository {
    return new MemoryWebhookRetentionRepository(input.database);
  }

  async pruneDeliveries({ now = nowInstant() }: { now?: Instant } = {}): Promise<number> {
    return this.database.pruneDeliveriesBefore(now.subtract({ hours: 30 * 24 }));
  }

  async pruneExpiredIdempotencyReceipts(): Promise<number> {
    return 0;
  }
}

class MemoryWebhookIds implements WebhookId {
  newEndpointId(): string {
    return generate("webhookendpoint").toString();
  }
}

/** Not a cipher: round-trips the value so a memory-backed boot never has to
 *  compose an encryption key it has no deployment secret to derive. */
class MemoryWebhookSecrets implements WebhookSecret {
  encrypt(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  decrypt(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
  }
}

export class MemoryWebhookRepositories {
  static readonly requires = [] as const;

  static create(): WebhookRepositories {
    const database = MemoryWebhookDatabase.create();

    return {
      dispatchCaps: MemoryWebhookDispatchCapRepository.create(),
      endpoints: MemoryWebhookEndpointRepository.create({
        database,
        options: { ids: new MemoryWebhookIds(), secrets: new MemoryWebhookSecrets() },
      }),
      retention: MemoryWebhookRetentionRepository.create({ database }),
      rateLimits: MemoryWebhookRateLimitRepository.create(),
    };
  }
}
