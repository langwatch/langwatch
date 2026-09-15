/**
 * Live tier combining Postgres and ClickHouse; hand-written to span two stores coexisting.
 */
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { WebhookId } from "../../app/webhook.app.ts";
import type { WebhookSecret } from "../../app/webhook.app.ts";
import { WebhookEndpointConfiguration } from "../../services/webhook-endpoint-policy.service.ts";
import type { WebhookRepositories } from "../webhook.repositories.ts";
import {
  WebhookEventsClickHouseRepository,
  type WebhookClickHouseClientResolver,
} from "../clickhouse/clickhouse.webhook-events.repository.ts";
import { PrismaWebhookEndpointRepository } from "./prisma.webhook-endpoint.repository.ts";
import { PrismaWebhookRetentionRepository } from "./prisma.webhook-retention.repository.ts";
import { PrismaWebhookTenantsRepository } from "./prisma.webhook-tenants.repository.ts";

/** The endpoint identifier this deployment mints, in the module's own format. */
class LiveWebhookIds implements WebhookId {
  newEndpointId(): string {
    return generate("webhookendpoint").toString();
  }
}

/**
 * Endpoint signing secret using the process's shared encryption cipher.
 */
class CipherWebhookSecrets implements WebhookSecret {
  static create(cipher: WebhookSecret): CipherWebhookSecrets {
    return new CipherWebhookSecrets(cipher);
  }

  private constructor(private readonly cipher: WebhookSecret) {}

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }
}

export class PostgresWebhookRepositories {
  static readonly requires = ["prisma", "clickhouse", "encryption"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      clickhouse: WebhookClickHouseClientResolver;
      encryption: WebhookSecret;
    }>,
  ): WebhookRepositories {
    return {
      endpoints: PrismaWebhookEndpointRepository.create({
        prisma: members.prisma,
        ids: new LiveWebhookIds(),
        secrets: CipherWebhookSecrets.create(members.encryption),
        configuration: WebhookEndpointConfiguration.create(),
      }),
      events: WebhookEventsClickHouseRepository.create(members.clickhouse),
      retention: PrismaWebhookRetentionRepository.create({ prisma: members.prisma }),
      tenants: PrismaWebhookTenantsRepository.create(members.prisma),
    };
  }
}
