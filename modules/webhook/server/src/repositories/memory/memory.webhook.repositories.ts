import { generate } from "@langwatch/ksuid";
import { WebhookId } from "../../app/webhook.app.ts";
import { WebhookSecret } from "../../app/webhook.app.ts";
import type { WebhookRepositories } from "../webhook.repositories.ts";
import { MemoryWebhookDatabase } from "./memory.webhook-database.ts";
import { MemoryWebhookEndpointRepository } from "./memory.webhook-endpoint.repository.ts";
import { MemoryWebhookEventsRepository } from "./memory.webhook-events.repository.ts";
import { MemoryWebhookRetentionRepository } from "./memory.webhook-retention.repository.ts";
import { MemoryWebhookTenantsRepository } from "./memory.webhook-tenants.repository.ts";

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
      endpoints: MemoryWebhookEndpointRepository.create({
        database,
        options: { ids: new MemoryWebhookIds(), secrets: new MemoryWebhookSecrets() },
      }),
      events: MemoryWebhookEventsRepository.create(),
      retention: MemoryWebhookRetentionRepository.create({ database }),
      tenants: MemoryWebhookTenantsRepository.create(),
    };
  }
}
