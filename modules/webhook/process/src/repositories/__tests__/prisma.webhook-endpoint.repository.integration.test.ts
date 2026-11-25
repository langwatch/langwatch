/**
 * @vitest-environment node
 *
 * The endpoint create key against real Postgres: the unique (organizationId, idempotencyKey)
 * index is what makes a concurrent create answer one endpoint.
 */
import { randomBytes } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { PrismaWebhookEndpointRepository } from "../prisma/prisma.webhook-endpoint.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("webhook-endpoint-key-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const ids: WebhookId = { newEndpointId: () => `whep_${randomBytes(6).toString("hex")}` };
const secrets: WebhookSecret = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.slice("enc:".length),
};
const ns = `webhook-key-${randomBytes(4).toString("hex")}`;

describe.skipIf(!databaseUrl)("given the Prisma webhook endpoint repository", () => {
  const organizationIds: string[] = [];
  let repository: PrismaWebhookEndpointRepository;

  const keyed = ({ organizationId, key }: { organizationId: string; key: string }) => ({
    organizationId,
    url: "https://receiver.example.com/hooks",
    enabledEvents: ["governance.anomaly_alert.triggered"],
    idempotencyKey: key,
  });

  beforeAll(async () => {
    for (const suffix of ["a", "b"]) {
      const organization = await prisma.organization.create({
        data: { name: `Webhook key org ${suffix}`, slug: `--test-org-${ns}-${suffix}` },
      });
      organizationIds.push(organization.id);
    }
    repository = PrismaWebhookEndpointRepository.create({ prisma, ids, secrets });
  });

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await cleanupTestRows(prisma, [["webhookEndpoint", { organizationId }]]);
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await connection?.closeOnce();
  });

  describe("when a create carries an idempotency key", () => {
    /** @scenario "A create that repeats an idempotency key answers the endpoint it made" */
    it("answers the first endpoint and its secret on a repeat", async () => {
      const input = keyed({ organizationId: organizationIds[0]!, key: `${ns}:repeat` });
      const first = await repository.create(input);
      const repeat = await repository.create(input);

      expect(repeat.endpoint.id).toBe(first.endpoint.id);
      expect(repeat.secret).toBe(first.secret);
    });

    /** @scenario "Concurrent creates with one idempotency key make one endpoint" */
    it("makes one endpoint from concurrent creates", async () => {
      const input = keyed({ organizationId: organizationIds[0]!, key: `${ns}:race` });
      const results = await Promise.all(Array.from({ length: 4 }, () => repository.create(input)));

      expect(new Set(results.map(({ endpoint }) => endpoint.id)).size).toBe(1);
      expect(
        await prisma.webhookEndpoint.count({
          where: { organizationId: organizationIds[0]!, idempotencyKey: `${ns}:race` },
        }),
      ).toBe(1);
    });

    /** @scenario "Another organization's identical idempotency key makes its own endpoint" */
    it("keeps each organization's key independent", async () => {
      const key = `${ns}:shared`;
      const mine = await repository.create(keyed({ organizationId: organizationIds[0]!, key }));
      const theirs = await repository.create(keyed({ organizationId: organizationIds[1]!, key }));

      expect(theirs.endpoint.id).not.toBe(mine.endpoint.id);
      expect(theirs.endpoint.organizationId).toBe(organizationIds[1]);
    });

    /** @scenario "An archived endpoint gives its idempotency key up" */
    it("creates a fresh endpoint once the keyed one is archived", async () => {
      const input = keyed({ organizationId: organizationIds[0]!, key: `${ns}:archived` });
      const first = await repository.create(input);
      await repository.archive({
        organizationId: organizationIds[0]!,
        endpointId: first.endpoint.id,
      });
      const again = await repository.create(input);

      expect(again.endpoint.id).not.toBe(first.endpoint.id);
    });
  });
});
