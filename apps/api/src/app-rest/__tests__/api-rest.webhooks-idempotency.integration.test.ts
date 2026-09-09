/**
 * @see specs/ai-gateway/idempotency.feature
 * `Idempotency-Key` on the webhook endpoint create, over the process's real
 * receipt ledger: this family authenticates at the organization.
 */
import { randomBytes } from "node:crypto";
import { HandledError } from "@langwatch/handled-error";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { WebhookApp, WebhookEndpointAdapter } from "@langwatch/webhook-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeApiIdempotency } from "../../app/api-idempotency.composition.ts";
import { RestAuthWorld } from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

/** 32 bytes of hex, which is what the stored-secret cipher refuses anything else for. */
const CREDENTIALS_SECRET = "d".repeat(64);
const ORGANIZATION_KEY = "sk-lw-webhooks-admin";

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

const ns = `whidem-${randomBytes(4).toString("hex")}`;
const ORGANIZATION_ID = `org-${ns}`;

describe.skipIf(!databaseUrl)("given the webhook endpoint create over the receipt ledger", () => {
  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORGANIZATION_ID, name: ns, slug: ns } });
  });

  afterAll(async () => {
    await prisma.webhookEndpoint.deleteMany({ where: { organizationId: ORGANIZATION_ID } });
    await prisma.idempotencyReceipt.deleteMany({ where: { scopeId: ORGANIZATION_ID } });
    await prisma.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
  });

  describe("when the same create is sent twice under one key", () => {
    /** @scenario An idempotency key on this family is unique within the organization */
    it("replays the stored response, secret and all, against the organization's own receipt", async () => {
      const api = mountWebhooks();
      const key = `idem-webhook-${randomBytes(4).toString("hex")}`;
      const body = {
        url: "https://example.com/hooks/idempotent",
        enabled_events: ["gateway.request.completed"],
      };
      const send = (payload: unknown) =>
        api.post("/api/webhooks/v1/endpoints", payload, {
          authorization: `Bearer ${ORGANIZATION_KEY}`,
          "Idempotency-Key": key,
        });

      const first = await send(body);
      expect(first.status).toBe(201);
      expect(first.headers.get("X-Idempotent-Replay")).toBeNull();
      const firstBytes = await first.text();
      const firstBody = JSON.parse(firstBytes) as { data: { id: string; secret: string } };

      const second = await send(body);
      expect(second.status).toBe(201);
      expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
      const replayedBytes = await second.text();
      const replayed = JSON.parse(replayedBytes) as { data: { id: string; secret: string } };
      // Including the signing secret: the endpoint hands that out once, so a
      // replay that withheld it would answer with an endpoint nobody can
      // verify, and a second execution would answer with a different one.
      expect(replayed.data.secret).toBe(firstBody.data.secret);
      expect(replayed.data.id).toBe(firstBody.data.id);
      // Byte-for-byte, not merely equivalent: the receipt holds the bytes the
      // first response wrote, so a replay cannot differ from it by key order.
      expect(replayedBytes).toBe(firstBytes);

      const receipt = await prisma.idempotencyReceipt.findUnique({
        where: { scopeId_key: { scopeId: ORGANIZATION_ID, key } },
      });
      expect(receipt?.responseStatus).toBe(201);

      const stored = await prisma.webhookEndpoint.findMany({
        where: { organizationId: ORGANIZATION_ID, url: body.url },
      });
      expect(stored).toHaveLength(1);
    });
  });

  describe("when the same key is reused for a different create", () => {
    /** @scenario An idempotency key on this family is unique within the organization */
    it("refuses with idempotency_error rather than creating a second endpoint", async () => {
      const api = mountWebhooks();
      const key = `idem-webhook-${randomBytes(4).toString("hex")}`;
      const headers = {
        authorization: `Bearer ${ORGANIZATION_KEY}`,
        "Idempotency-Key": key,
      };

      const first = await api.post(
        "/api/webhooks/v1/endpoints",
        {
          url: "https://example.com/hooks/first",
          enabled_events: ["gateway.request.completed"],
        },
        headers,
      );
      expect(first.status).toBe(201);

      const mutated = await api.post(
        "/api/webhooks/v1/endpoints",
        {
          url: "https://example.com/hooks/other",
          enabled_events: ["gateway.request.completed"],
        },
        headers,
      );

      expect(mutated.status).toBe(409);
      await expect(mutated.json()).resolves.toMatchObject({ error: "idempotency_error" });
      expect(
        await prisma.webhookEndpoint.findMany({
          where: { organizationId: ORGANIZATION_ID, url: "https://example.com/hooks/other" },
        }),
      ).toHaveLength(0);
    });
  });
});

function mountWebhooks(): MountedRestFamily {
  const encryption = AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET });
  const idempotency = composeApiIdempotency({ database: prisma, encryption });
  if (!idempotency) throw new Error("this suite needs the process's receipt ledger");

  const endpoints = WebhookEndpointAdapter.create({
    prisma,
    ids: { newEndpointId: () => `whep_${randomBytes(6).toString("hex")}` },
    secrets: {
      encrypt: (value: string) => encryption.encrypt(value),
      decrypt: (value: string) => encryption.decrypt(value),
    },
  });

  const webhooks = WebhookApp.create({
    endpoints,
    health: { health: async () => ({}) as never },
    events: undefined,
    assertEndpointsEntitled: async () => {},
    dispatch: async () => {
      throw new Error("this suite never fires a test delivery");
    },
  });

  const world = RestAuthWorld.create({
    projects: [],
    keys: [
      {
        token: ORGANIZATION_KEY,
        kind: "organization",
        organizationId: ORGANIZATION_ID,
        apiKeyId: "api-key-webhooks",
        grants: ["webhookEndpoints:manage"],
      },
    ],
    organizations: [ORGANIZATION_ID],
  });

  return mountRestFamily({
    security: world.security({ idempotency: idempotency.run }),
    packaged: { webhooks: () => webhooks } as never,
    packagedPorts: { canonicalError },
  });
}

/** The refusal envelope this process publishes, as the family's onError renders it. */
function canonicalError(error: unknown) {
  if (HandledError.isHandled(error)) {
    return {
      status: (error.httpStatus ?? 500) as never,
      body: { error: error.code, message: error.message, meta: error.meta } as never,
    };
  }

  return { status: 500 as never, body: { error: "internal_error" } as never };
}
