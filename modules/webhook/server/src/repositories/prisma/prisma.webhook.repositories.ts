/**
 * The "postgres" tier. Hand-written rather than `prismaRepositories(...)`
 * because it spans two stores that coexist rather than compete: Postgres
 * holds the endpoint registry and the retention rows, ClickHouse holds the
 * emitted event envelopes. The tier name is Postgres's because that is the
 * store every other repository in the module lives in; ClickHouse is a
 * second required input to the same tier, not an alternative to it. The
 * endpoint registry also needs the deployment's own id and secret codecs.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { WebhookId } from "../../app/webhook.app.ts";
import type { WebhookSecret } from "../../app/webhook.app.ts";
import type { WebhookEndpointConfiguration } from "../../services/webhook-endpoint-policy.service.ts";
import type { WebhookRepositories } from "../webhook.repositories.ts";
import {
  WebhookEventsClickHouseRepository,
  type WebhookClickHouseClientResolver,
} from "../clickhouse/clickhouse.webhook-events.repository.ts";
import { PrismaWebhookEndpointRepository } from "./prisma.webhook-endpoint.repository.ts";
import { PrismaWebhookRetentionRepository } from "./prisma.webhook-retention.repository.ts";
import { PrismaWebhookTenantsRepository } from "./prisma.webhook-tenants.repository.ts";

export class PostgresWebhookRepositories {
  static readonly requires = ["prisma", "ids", "secrets", "clickhouse", "configuration"] as const;

  static create(
    infrastructure: Readonly<{
      prisma: PrismaClient;
      ids: WebhookId;
      secrets: WebhookSecret;
      clickhouse: WebhookClickHouseClientResolver;
      configuration: WebhookEndpointConfiguration;
    }>,
  ): WebhookRepositories {
    return {
      endpoints: PrismaWebhookEndpointRepository.create({
        prisma: infrastructure.prisma,
        ids: infrastructure.ids,
        secrets: infrastructure.secrets,
        configuration: infrastructure.configuration,
      }),
      events: WebhookEventsClickHouseRepository.create(infrastructure.clickhouse),
      retention: PrismaWebhookRetentionRepository.create({ prisma: infrastructure.prisma }),
      tenants: PrismaWebhookTenantsRepository.create(infrastructure.prisma),
    };
  }
}
