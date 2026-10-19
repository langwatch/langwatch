/**
 * The delivery-log prune under the production tenancy guard, which answers every statement
 * it admits itself so nothing reaches a database.
 * @see specs/webhooks/webhook-endpoints.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  PrismaTenancyGuardService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { PrismaWebhookEndpointRepository } from "../prisma.webhook-endpoint.repository.ts";

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);

      return context.action === "executeRaw" ? 3 : { count: 3 };
    });
  }
}

function repositoryBehindTheGuard() {
  const guard = new TenancyGuardOnly();
  const connection = PrismaConnectionService.create({
    guard,
    logger: createTestLogger().logger,
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://guard-only@127.0.0.1:1/unreachable",
      log: ["error"],
    }),
  );
  const repository = PrismaWebhookEndpointRepository.create({
    prisma: connection.client,
    ids: { newEndpointId: () => "webhook_endpoint_1" },
    secrets: { encrypt: (value) => value, decrypt: (value) => value },
  });

  return { guard, repository };
}

describe("given the Prisma webhook endpoint repository behind the tenancy guard", () => {
  describe("when the hourly maintenance prunes the delivery log", () => {
    /** @scenario "The delivery-log prune is admitted by the tenancy guard" */
    it("runs the one system-owned retention sweep rather than a refused cross-tenant delete", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      const removed = await repository.pruneDeliveries(
        Temporal.Instant.from("2026-09-27T12:00:00Z"),
      );

      expect(removed).toBe(3);
      expect(guard.admitted).toEqual(["executeRaw"]);
    });
  });
});
