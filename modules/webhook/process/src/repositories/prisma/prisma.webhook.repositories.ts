/**
 * Live tier combining Postgres and ClickHouse; hand-written to span two stores coexisting.
 */
import { generate } from "@langwatch/ksuid";
import type { RateLimiter } from "@langwatch/process-stores";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { webhookEndpointConfiguration } from "../../rules/webhook-endpoint-policy.rules.ts";
import {
  WebhookEventsClickHouseRepository,
  type WebhookRoutedClickHouse,
} from "../clickhouse/clickhouse.webhook-events.repository.ts";
import {
  RedisWebhookDispatchCapRepository,
  type WebhookDispatchCounter,
} from "../redis/redis.webhook-dispatch-cap.repository.ts";
import { RedisWebhookRateLimitRepository } from "../redis/redis.webhook-rate-limit.repository.ts";
import type { WebhookRepositories } from "../webhook.repositories.ts";
import {
  PrismaWebhookEndpointRepository,
  type WebhookEndpointDatabase,
} from "./prisma.webhook-endpoint.repository.ts";
import {
  PrismaWebhookRetentionRepository,
  type WebhookRetentionDatabase,
} from "./prisma.webhook-retention.repository.ts";

/** Every model the live tier's Postgres repositories read, and nothing else. */
export type WebhookLiveDatabase = WebhookEndpointDatabase & WebhookRetentionDatabase;

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
  static readonly requires = [
    "prisma",
    "clickhouse",
    "encryption",
    "redis",
    "rateLimiter",
  ] as const;

  static create(
    members: Readonly<{
      prisma: WebhookLiveDatabase;
      clickhouse: WebhookRoutedClickHouse;
      encryption: WebhookSecret;
      redis: WebhookDispatchCounter;
      rateLimiter: RateLimiter;
    }>,
  ): WebhookRepositories {
    return {
      dispatchCaps: RedisWebhookDispatchCapRepository.create({ connection: members.redis }),
      endpoints: PrismaWebhookEndpointRepository.create({
        prisma: members.prisma,
        ids: new LiveWebhookIds(),
        secrets: CipherWebhookSecrets.create(members.encryption),
        configuration: webhookEndpointConfiguration(),
      }),
      events: WebhookEventsClickHouseRepository.forRoutedClickHouse(members.clickhouse),
      retention: PrismaWebhookRetentionRepository.create({ prisma: members.prisma }),
      rateLimits: RedisWebhookRateLimitRepository.create(members.rateLimiter),
    };
  }
}
