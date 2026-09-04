// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The delivery log's own cursor pagination, against real Postgres.
 *
 * Ported from
 * platform/app/ee/webhooks/__tests__/webhookEndpoint.service.integration.test.ts,
 * whose `WebhookEndpointService.getDeliveries` is this package's
 * `PrismaWebhookEndpointRepository.getDeliveries` (the endpoint-service
 * class dissolved into the repository when the application moved). Kept as
 * its own file rather than folded into
 * `prisma.webhook-endpoint.repository.integration.test.ts` — another lane
 * was mid-edit on that file when this one was written.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { WebhookIdPort } from "../../../ports/webhook-id.port";
import type { WebhookSecretPort } from "../../../ports/webhook-secret.port";
import { PrismaWebhookEndpointRepository } from "../prisma.webhook-endpoint.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ids: WebhookIdPort = {
  newEndpointId: () => `whep_${randomBytes(6).toString("hex")}`,
};
const secrets: WebhookSecretPort = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

describe.skipIf(!databaseUrl)("PrismaWebhookEndpointRepository delivery log", () => {
  const ns = `whep-log-${randomBytes(4).toString("hex")}`;
  const orgId = `org-${ns}`;
  let endpointId: string;

  const repo = PrismaWebhookEndpointRepository.create({ prisma, ids, secrets });

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: ns, slug: ns } });
    const { endpoint } = await repo.create({
      organizationId: orgId,
      url: "https://example.com/hooks/billing",
      enabledEvents: ["gateway.request.completed"],
    });
    endpointId = endpoint.id;
  });

  afterAll(async () => {
    await prisma.webhookEndpointDelivery.deleteMany({ where: { organizationId: orgId } });
    await prisma.webhookEndpoint.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await connection?.closeOnce();
  });

  /** @scenario The delivery log is cursor-paginated newest-first */
  it("cursor-paginates the delivery log newest-first, with no overlap across the page boundary", async () => {
    const base = new Date("2026-07-31T00:00:00.000Z").getTime();
    for (let i = 0; i < 5; i++) {
      await repo.recordDeliveryAttempt({
        organizationId: orgId,
        endpointId,
        dispatchId: `pageable-${i}`,
        attempt: 1,
        eventCount: 1,
        outcome: "success",
        responseStatus: 200,
        latencyMs: 10,
        now: new Date(base + i * 1000),
      });
    }

    const first = await repo.getDeliveries({ organizationId: orgId, endpointId, limit: 2 });
    expect(first.deliveries).toHaveLength(2);
    // Newest first: the last-recorded attempt leads.
    expect(first.deliveries[0]!.dispatchId).toBe("pageable-4");
    expect(first.deliveries[1]!.dispatchId).toBe("pageable-3");
    expect(first.nextCursor).not.toBeNull();

    const second = await repo.getDeliveries({
      organizationId: orgId,
      endpointId,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.deliveries.map((d) => d.dispatchId)).toEqual(["pageable-2", "pageable-1"]);

    // No overlap across the page boundary.
    const firstIds = first.deliveries.map((d) => d.id);
    expect(second.deliveries.every((d) => !firstIds.includes(d.id))).toBe(true);
  });
});
