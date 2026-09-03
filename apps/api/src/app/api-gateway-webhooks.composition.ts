/**
 * The Enterprise webhook platform, as the billing reconciliation family reads
 * it.
 *
 * ADR-072 gives a customer two views of one capability: the PUSH — spend
 * outcomes delivered to their endpoints by the worker's delivery process
 * manager — and the PULL — `/api/gateway/v1/spend-events` and friends, served
 * here. The fourth pull route is a REPLAY: "send these already-emitted
 * envelopes to this endpoint again", and it is the one that has to reach the
 * push side. Three members, and each answers a different question:
 *
 *   endpoints  which of this organization's endpoints is still deliverable
 *   events     which envelopes were emitted in the window being replayed
 *   delivery   append one of them to that endpoint's coalescing stream
 *
 * Without them the replay route refuses by name and the other three answer
 * normally, which is the honest split — a reconciliation client can still pull
 * its spend. This module is what closes it.
 *
 * ## This process appends; it does not deliver
 *
 * `appendReplayToEndpointStream` writes into the delivery process's outbox and
 * commits. The worker — the process that claims the shared queue and runs the
 * `webhook-delivery` process manager — is what freezes a batch, signs it and
 * ships it. So the delivery service composed here is given the process store
 * and the endpoint registry, and REFUSES BY NAME on the three collaborators
 * only its executors use: the last-hop transport, the entitlement read that
 * gates live delivery, and the receipt-expiry sweep. Binding real ones would
 * describe a process that could run those executors, and this one cannot —
 * it registers pipelines producer-only and holds no process runtime.
 *
 * That is also why the append is not a lesser form of delivery. It rides the
 * exact machinery the live path does — same buffer, same coalescing, same
 * batch identity — so a replayed delivery is indistinguishable from the
 * original at the receiver.
 *
 * ## What each absence costs
 *
 * NO DATABASE: no endpoint registry and no outbox, so there is nothing to
 * replay onto. NO CIPHER: an endpoint's signing secret is stored encrypted,
 * and a registry composed without the key would be one that cannot read what
 * it wrote. NO CLICKHOUSE: the emitted-envelope log has no fallback store, so
 * `events` alone is absent and the replay route says the log is unavailable
 * rather than reporting an empty window as "nothing was emitted".
 */
import { generate } from "@langwatch/ksuid";
import {
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEventsAdapter,
  WebhookEventsService,
  WebhookIdPort,
  WebhookSecretPort,
  type WebhookDeliveryProcessDeps,
  type WebhookEndpointRuntime,
} from "@langwatch/enterprise-api/webhooks";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiGatewaySpendWebhookPort } from "./api-gateway-spend-rest.composition";

/** One tenant's ClickHouse, as the emitted-envelope log reads it. */
export type ApiWebhookClickHouseResolver = Parameters<typeof WebhookEventsAdapter.create>[0];

export type ApiGatewayWebhooksOptions = Readonly<{
  /** The one guarded connection the registry and the outbox run on. */
  database: PrismaClient | undefined;
  /** The cipher an endpoint's signing secret was written under, or none. */
  encryption: SecretEncryptionPort | undefined;
  /** This process's ClickHouse, where the emitted envelopes are projected. */
  resolveClickHouseClient: ApiWebhookClickHouseResolver | null;
}>;

/**
 * Composes the three members the replay route reads, or reports that this
 * deployment cannot deliver at all.
 *
 * `undefined` without a database or a cipher, because both are the platform
 * rather than one of its parts. The spend family then binds a registry that
 * REFUSES by name — not one that answers `null`, which would tell a customer
 * their endpoint was deleted when the truth is that this deployment has no
 * webhook platform.
 */
export function composeApiGatewayWebhooks(
  options: ApiGatewayWebhooksOptions,
): ApiGatewaySpendWebhookPort | undefined {
  const { database, encryption, resolveClickHouseClient } = options;
  if (!database || !encryption) return undefined;

  const endpoints: WebhookEndpointRuntime = WebhookEndpointAdapter.create({
    prisma: database,
    ids: new ApiWebhookIds(),
    secrets: ApiWebhookSecrets.create(encryption),
    // No `configuration` and no `pruneDeliveries`: both are the WRITE side's
    // — destination validation on create, and the maintenance sweep the
    // delivery process manager runs. This process only reads an endpoint.
  });

  const delivery = WebhookDeliveryService.create({
    // The endpoint stream a replay appends to is a durable process row, so it
    // is the same Postgres the worker's process runtime drains from. A store
    // of its own here would append into rows nothing ships.
    processStore: PrismaProcessStore.create({ database }),
    endpoints,
    ...unrunExecutorCollaborators(),
  });

  return {
    endpoints,
    events: resolveClickHouseClient
      ? WebhookEventsService.create({
          prisma: database,
          repository: WebhookEventsAdapter.create(resolveClickHouseClient),
        })
      : undefined,
    delivery,
  };
}

/**
 * The three collaborators only the delivery service's EXECUTORS reach.
 *
 * Every one of them refuses, and the refusal is a statement about this
 * process rather than about the deployment: it registers pipelines
 * producer-only, so the live-delivery, send-batch and maintenance executors
 * never run here. Reaching one means a graph mounted the delivery process
 * manager on the tier that produces onto it, which is worth failing loudly
 * rather than quietly performing the worker's job in a web request.
 */
function unrunExecutorCollaborators(): Pick<
  WebhookDeliveryProcessDeps,
  "dispatch" | "getPlan" | "pruneExpiredIdempotencyReceipts"
> {
  const refuse = (capability: string): Promise<never> =>
    Promise.reject(
      new Error(
        `The API process runs no webhook delivery process manager, so it cannot ${capability}. This work belongs to the worker that claims the shared queue.`,
      ),
    );

  return {
    dispatch: () => refuse("deliver a batch to an endpoint's transport"),
    getPlan: () => refuse("read an organization's plan for the live-delivery gate"),
    pruneExpiredIdempotencyReceipts: () => refuse("sweep expired idempotency receipts"),
  };
}

/** The endpoint id format, as the resource prefix the platform already mints. */
class ApiWebhookIds extends WebhookIdPort {
  newEndpointId(): string {
    return generate("webhook_endpoint").toString();
  }
}

/**
 * An endpoint's signing secret, under the SAME cipher every other at-rest
 * secret on this process is written with.
 *
 * A second key here would produce endpoints whose secrets the worker cannot
 * read, and a customer verifying a signature against a secret we could no
 * longer decrypt would see every delivery fail verification.
 */
class ApiWebhookSecrets extends WebhookSecretPort {
  static create(cipher: SecretEncryptionPort): ApiWebhookSecrets {
    return new ApiWebhookSecrets(cipher);
  }

  private constructor(private readonly cipher: SecretEncryptionPort) {
    super();
  }

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }
}
