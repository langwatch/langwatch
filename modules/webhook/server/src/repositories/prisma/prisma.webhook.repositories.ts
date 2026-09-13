/**
 * The live tier. Hand-written rather than `prismaRepositories(...)`
 * because it spans two stores that coexist rather than compete: Postgres
 * holds the endpoint registry and the retention rows, ClickHouse holds the
 * emitted event envelopes. The tier name is Postgres's because that is the
 * store every other repository in the module lives in; ClickHouse is a
 * second required input to the same tier, not an alternative to it. The
 * endpoint registry also needs the deployment's own id and secret codecs, and
 * BUILDS them here rather than claiming them as members.
 *
 * `requires` may only name the fourteen keys of `ProcessMembers`, so `"ids"`
 * and `"configuration"` could never be satisfied — leftovers from when a
 * hand-written composition called `.create()` directly with its own arguments
 * (`apps/api/src/features/webhook/webhook.composition.ts`, deleted by
 * b383462d96). `"secrets"` was worse than unsatisfiable: it IS a member name,
 * so it resolved — and handed this tier the process's `SecretResolver`, whose
 * `read`/`find` is nothing like the `encrypt`/`decrypt` an endpoint secret
 * needs. A refusal would have been the kinder failure.
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
 * An endpoint's signing secret, under the SAME cipher every other at-rest
 * secret on this process is written with.
 *
 * A second key here would produce endpoints whose secrets the worker cannot
 * read, and a customer verifying a signature against a secret we could no
 * longer decrypt would see every delivery fail verification. That is why this
 * wraps the process's `encryption` member rather than holding a key of its own.
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
