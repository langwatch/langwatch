/**
 * `webhook.*` - the outbound-webhook endpoint registry, composed as its own
 * feature: an organization's endpoints, their delivery health, and the
 * emitted-events log a replay reads from.
 */
import { generate } from "@langwatch/ksuid";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";
import type { SecretEncryption } from "@langwatch/secret-server";
import {
  WebhookApp,
  WebhookEndpointConfiguration,
  type WebhookId,
  type WebhookSecret,
  webhookServer,
  type WebhookClickHouseClientResolver,
} from "@langwatch/webhook-server";

export type ComposedWebhookFeature = Readonly<{ app: WebhookApp }>;

/** The endpoint id format, as the resource prefix the platform mints. */
class ApiWebhookIds implements WebhookId {
  newEndpointId(): string {
    return generate("webhookendpoint").toString();
  }
}

/** An endpoint's signing secret, under the same cipher every other at-rest
 *  secret on this process is written with. */
class ApiWebhookSecrets implements WebhookSecret {
  static create(cipher: SecretEncryption): ApiWebhookSecrets {
    return new ApiWebhookSecrets(cipher);
  }

  private constructor(private readonly cipher: SecretEncryption) {}

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }
}

/**
 * Installs the outbound-webhook endpoint registry over this process's own
 * graph. Persistence is one "postgres" tier spanning two stores - Postgres
 * for the registry and the retention rows, ClickHouse for the emitted-event
 * envelopes - resolved by the module's own registry; this root hands it the
 * two connections and names no repository class.
 */
export async function installApiWebhook(options: {
  /** The one guarded connection the registry and the delivery log run on. */
  prisma: PrismaClient;
  /** The cipher an endpoint's signing secret is written under. */
  encryption: SecretEncryption;
  /** This process's ClickHouse, where the emitted envelopes are projected. */
  resolveClickHouseClient: WebhookClickHouseClientResolver;
}): Promise<ComposedWebhookFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", {
      prisma: options.prisma,
      ids: new ApiWebhookIds(),
      secrets: ApiWebhookSecrets.create(options.encryption),
      clickhouse: options.resolveClickHouseClient,
      configuration: WebhookEndpointConfiguration.create(),
    })
    .withInfrastructure({})
    .withModule(webhookServer, {
      infrastructure: {
        processStore: PrismaProcessStore.create({ database: options.prisma }),
        // The API process serves reads and mutations; delivery itself is the
        // worker's process manager, so the doors on this process never call
        // through to a real transport.
        assertEndpointsEntitled: () => Promise.resolve(),
        dispatch: () =>
          Promise.reject(new Error("The API process cannot dispatch webhook delivery.")),
      },
    })
    .boot({ role: "api" });

  return { app: runtime.module(webhookServer).provided };
}
