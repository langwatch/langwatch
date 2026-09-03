/**
 * The webhook platform the billing reconciliation family's replay route reads.
 *
 * The route was the last named absence on that family: it refused by name
 * because `apps/api` composed no endpoint registry, no emitted-envelope log
 * and no delivery outbox. What is pinned here is that the three now arrive as
 * ONE member — a process cannot hold the registry without the outbox — that
 * the log alone degrades where a deployment keeps no ClickHouse, and that the
 * family's ports are wired to exactly these rather than to the refusing
 * registry that stood in for them.
 *
 * @see apps/api/src/app/api-gateway-webhooks.composition.ts
 * @see apps/api/src/app/api-gateway-spend-rest.composition.ts
 */
// @vitest-environment node
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";

import { composeApiGatewaySpendRest } from "../api-gateway-spend-rest.composition";
import { composeApiGatewayWebhooks } from "../api-gateway-webhooks.composition";

/**
 * The connection, as the two stores under it read it.
 *
 * The four `processManager*` models are what the durable process store checks
 * for before it will construct, which is the same check production makes.
 */
function testDatabase(): PrismaClient {
  return {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
    webhookEndpoint: {},
    project: {},
  } as unknown as PrismaClient;
}

/** The stored-secret cipher, as the endpoint registry holds it. */
function testCipher(): SecretEncryptionPort {
  return {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ""),
  } as SecretEncryptionPort;
}

const testClickHouse = async () => ({ query: async () => ({ json: async () => ({}) }) });

describe("the API's Enterprise webhook platform", () => {
  describe("given a process holding a database and the stored-secret cipher", () => {
    it("composes the registry, the emitted-envelope log and the delivery outbox", () => {
      const webhooks = composeApiGatewayWebhooks({
        database: testDatabase(),
        encryption: testCipher(),
        resolveClickHouseClient: testClickHouse,
      });

      expect(webhooks?.endpoints.tryGetDeliverable).toBeTypeOf("function");
      expect(webhooks?.events?.getEmittedEvents).toBeTypeOf("function");
      expect(webhooks?.delivery?.appendReplayToEndpointStream).toBeTypeOf("function");
    });
  });

  describe("given a process that keeps no ClickHouse", () => {
    it("still composes the platform, with only the emitted-envelope log absent", () => {
      const webhooks = composeApiGatewayWebhooks({
        database: testDatabase(),
        encryption: testCipher(),
        resolveClickHouseClient: null,
      });

      expect(webhooks?.endpoints.tryGetDeliverable).toBeTypeOf("function");
      expect(webhooks?.delivery?.appendReplayToEndpointStream).toBeTypeOf("function");
      expect(webhooks?.events).toBeUndefined();
    });
  });

  describe("given a process that composed no cipher", () => {
    it("composes no platform at all, because an endpoint secret is stored encrypted", () => {
      expect(
        composeApiGatewayWebhooks({
          database: testDatabase(),
          encryption: undefined,
          resolveClickHouseClient: testClickHouse,
        }),
      ).toBeUndefined();
    });
  });

  describe("given the reconciliation family composed over that platform", () => {
    it("reads the replay's three collaborators off it rather than refusing by name", async () => {
      const webhooks = composeApiGatewayWebhooks({
        database: testDatabase(),
        encryption: testCipher(),
        resolveClickHouseClient: testClickHouse,
      });
      if (!webhooks) throw new Error("the platform refused a process holding both halves");

      const { ports } = composeApiGatewaySpendRest({
        prisma: testDatabase(),
        gateway: { spendEvents: undefined, budgetSpend: undefined },
        plans: {} as unknown as PlanProvider,
        settlementGraceMs: 60_000,
        webhooks,
      });

      expect(ports.webhookEndpoints).toBe(webhooks.endpoints);
      expect(ports.webhookEvents).toBe(webhooks.events);
      expect(ports.webhookDelivery).toBe(webhooks.delivery);
    });

    it("refuses the replay by name where the deployment composed no platform", async () => {
      const { ports } = composeApiGatewaySpendRest({
        prisma: testDatabase(),
        gateway: { spendEvents: undefined, budgetSpend: undefined },
        plans: {} as unknown as PlanProvider,
        settlementGraceMs: 60_000,
      });

      // A refusal rather than `null`: a null reads as "no such endpoint",
      // which tells a customer their endpoint was deleted when the truth is
      // that this deployment cannot deliver at all.
      await expect(
        ports.webhookEndpoints.tryGetDeliverable({
          organizationId: "organization-1",
          endpointId: "webhook_endpoint_1",
        }),
      ).rejects.toThrow(/webhook delivery platform/);
    });
  });
});
