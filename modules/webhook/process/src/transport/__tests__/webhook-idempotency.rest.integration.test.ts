// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";

/**
 * `POST /api/webhooks/v1/endpoints` behind the real receipt ledger over the
 * real receipt table: the key is unique within the organization.
 * @see specs/ai-gateway/idempotency.feature
 */
import { IdempotencyLedger } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { endpointWithSecretResponseSchema } from "@langwatch/webhook-contract";
import { afterAll, describe, expect, it } from "vitest";

import type { WebhookAppDependencies } from "../../app/webhook.app.ts";
import { mountWebhookRest, ORGANIZATION_ID } from "./webhook-rest.harness.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("webhook-idempotency-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const KEY = `order-${randomBytes(6).toString("hex")}`;
const createdAt = new Date("2026-07-20T00:00:00.000Z");

function endpointRow(id: string) {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    destinationKind: "http" as const,
    url: "https://example.test/hook",
    sqs: null,
    enabledEvents: ["gateway.request.completed"],
    status: "ACTIVE" as const,
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 50,
    maxBatchDelayMs: 5000,
    maxInFlight: 4,
    createdAt,
    updatedAt: createdAt,
  };
}

/** A create that mints a fresh id and secret on every call, so a second run is visible. */
function mintingEndpoints() {
  let minted = 0;
  const endpoints = createApiFixture<WebhookAppDependencies["endpoints"]>({
    create: async () => {
      minted += 1;
      return { endpoint: endpointRow(`endpoint-${minted}`), secret: `whsec_${minted}` };
    },
  });
  return { endpoints, minted: () => minted };
}

describe.skipIf(!connection)("the webhook endpoint create under an Idempotency-Key", () => {
  afterAll(async () => {
    await prisma.idempotencyReceipt.deleteMany({ where: { key: KEY } });
    await prisma.$disconnect();
  });

  /** @scenario An idempotency key on this family is unique within the organization */
  it("replays the first secret and refuses a different body, the receipt held by the organization", async () => {
    const { endpoints, minted } = mintingEndpoints();
    const { request } = mountWebhookRest(
      { endpoints },
      {
        idempotency: IdempotencyLedger.create({
          receipts: prisma,
          cipher: { encrypt: (value) => `enc:${value}`, decrypt: (value) => value.slice(4) },
        }).run,
      },
    );
    const send = (body: unknown) =>
      request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": KEY },
        body: JSON.stringify(body),
      });
    const body = {
      url: "https://example.test/hook",
      enabled_events: ["gateway.request.completed"],
    };

    const first = await send(body);
    const replay = await send(body);

    expect(first.status).toBe(201);
    expect(first.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(replay.status).toBe(201);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    const firstBody = endpointWithSecretResponseSchema.parse(await first.json());
    const replayBody = endpointWithSecretResponseSchema.parse(await replay.json());
    expect(replayBody.data.secret).toBe(firstBody.data.secret);
    expect(minted()).toBe(1);

    const receipts = await prisma.idempotencyReceipt.findMany({ where: { key: KEY } });
    expect(receipts.map((receipt) => receipt.scopeId)).toEqual([ORGANIZATION_ID]);

    const different = await send({ ...body, url: "https://example.test/other" });

    expect(different.status).toBe(409);
    const refusal = (await different.json()) as { code: string };
    expect(refusal.code).toBe("idempotency_error");
    expect(minted()).toBe(1);
  });
});
