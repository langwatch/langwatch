/**
 * @vitest-environment node
 * Web Push rows on a real Postgres: one per endpoint, and one encrypted VAPID pair, race-safe.
 * Spec: modules/notification/specs/web-push.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaWebPushSubscriptionRepository } from "../prisma.web-push-subscription.repository.ts";
import { PrismaWebPushVapidKeyRepository } from "../prisma.web-push-vapid-key.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `webpush-${randomUUID()}`;
const ADA = `ada-${RUN}`;
const GRACE = `grace-${RUN}`;
const endpoint = (device: string) => `https://fcm.googleapis.com/fcm/send/${RUN}-${device}`;

/** A reversible stand-in for the process cipher, so the stored column is visibly not plaintext. */
const cipher = {
  encrypt: (plaintext: string) => `enc:${Buffer.from(plaintext).toString("base64")}`,
  decrypt: (ciphertext: string) =>
    Buffer.from(ciphertext.replace(/^enc:/, ""), "base64").toString("utf8"),
};

describe.skipIf(!databaseUrl)("given Web Push rows in Postgres", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:notification-web-push:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    await connection.client.webPushSubscription.deleteMany({
      where: { userId: { in: [ADA, GRACE] } },
    });
    await connection.client.$disconnect();
  });

  const subscriptions = () =>
    PrismaWebPushSubscriptionRepository.create({ prisma: connection.client });

  describe("when a browser subscribes", () => {
    /** @scenario "Subscribing stores the device" */
    it("stores the user id, the endpoint, both keys and the user agent", async () => {
      await subscriptions().upsert({
        userId: ADA,
        endpoint: endpoint("laptop"),
        p256dh: "p256dh-1",
        auth: "auth-1",
        userAgent: "Chrome on Linux",
      });

      const [row] = await subscriptions().findByUser(ADA);
      expect(row).toMatchObject({
        userId: ADA,
        endpoint: endpoint("laptop"),
        p256dh: "p256dh-1",
        auth: "auth-1",
        userAgent: "Chrome on Linux",
        lastSuccessAt: null,
      });
    });
  });

  describe("when the same browser subscribes again", () => {
    /** @scenario "The same browser subscribing again updates its row" */
    it("keeps one row for the endpoint, holding the new keys", async () => {
      await subscriptions().upsert({
        userId: ADA,
        endpoint: endpoint("laptop"),
        p256dh: "p256dh-2",
        auth: "auth-2",
        userAgent: null,
      });

      const rows = await connection.client.webPushSubscription.findMany({
        where: { endpoint: endpoint("laptop") },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ p256dh: "p256dh-2", auth: "auth-2" });
    });
  });

  describe("when another person subscribes on the same browser", () => {
    /** @scenario "A browser that changes hands moves to the new person" */
    it("moves the endpoint to the second person only", async () => {
      await subscriptions().upsert({
        userId: GRACE,
        endpoint: endpoint("laptop"),
        p256dh: "p256dh-3",
        auth: "auth-3",
        userAgent: null,
      });

      await expect(subscriptions().findByUser(ADA)).resolves.toEqual([]);
      await expect(subscriptions().findByUser(GRACE)).resolves.toHaveLength(1);
    });
  });

  describe("when a person subscribed on two browsers unsubscribes one", () => {
    /** @scenario "One person keeps a subscription per device" */
    it("removes only that browser's row", async () => {
      for (const device of ["desk", "phone"]) {
        await subscriptions().upsert({
          userId: ADA,
          endpoint: endpoint(device),
          p256dh: "key",
          auth: "auth",
          userAgent: null,
        });
      }

      await subscriptions().deleteForUser({ userId: GRACE, endpoint: endpoint("desk") });
      await subscriptions().deleteForUser({ userId: ADA, endpoint: endpoint("desk") });

      const left = await subscriptions().findByUser(ADA);
      expect(left.map((row) => row.endpoint)).toEqual([endpoint("phone")]);
    });
  });

  describe("when two processes store a newly generated VAPID pair at once", () => {
    /** @scenario "Two processes generating at once end up with one pair" */
    it("stores one pair, encrypted, and both answer with it", async () => {
      await connection.client.webPushVapidKey.deleteMany({ where: { id: "self" } });
      const first = PrismaWebPushVapidKeyRepository.create({ prisma: connection.client, cipher });
      const second = PrismaWebPushVapidKeyRepository.create({ prisma: connection.client, cipher });

      const [a, b] = await Promise.all([
        first.insertIfAbsent({ publicKey: "public-a", privateKey: "private-a" }),
        second.insertIfAbsent({ publicKey: "public-b", privateKey: "private-b" }),
      ]);

      expect(a).toEqual(b);
      const rows = await connection.client.webPushVapidKey.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.privateKeyEncrypted).not.toContain("private-");
      expect(cipher.decrypt(rows[0]!.privateKeyEncrypted)).toBe(a.privateKey);
      await connection.client.webPushVapidKey.deleteMany({ where: { id: "self" } });
    });
  });
});
