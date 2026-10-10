/**
 * @vitest-environment node
 * The per-person notification choice against a real Postgres: a topic nobody
 * answered reads empty, and one topic is written without touching the others.
 * Spec: specs/langy/langy-notifications.feature
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

import { PrismaUserRepository } from "../prisma.user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `notify-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given a person who never answered the notifications offer", () => {
  let connection: PrismaConnection;
  let userId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-notifications:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const created = await connection.client.user.create({
      data: { name: `Ada ${RUN}`, email: `ada@${RUN}.acme.test` },
    });
    userId = created.id;
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  it("reads an empty map", async () => {
    const users = PrismaUserRepository.create({ prisma: connection.client });

    await expect(users.findNotificationPreferences(userId)).resolves.toEqual({});
  });

  describe("when a topic is answered, then changed", () => {
    it("reads the latest answer and keeps what another release stored", async () => {
      await connection.client.user.update({
        where: { id: userId },
        data: { notificationPreferences: { future: "enabled", broken: 3 } },
      });
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await users.setNotificationPreference({ id: userId, topic: "langy", choice: "enabled" });
      await users.setNotificationPreference({ id: userId, topic: "langy", choice: "declined" });

      await expect(users.findNotificationPreferences(userId)).resolves.toEqual({
        future: "enabled",
        langy: "declined",
      });
      const stored = await connection.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { notificationPreferences: true },
      });
      expect(stored.notificationPreferences).toEqual({
        future: "enabled",
        broken: 3,
        langy: "declined",
      });
    });
  });

  describe("when two topics are answered at the same time", () => {
    it("keeps both answers", async () => {
      await connection.client.user.update({
        where: { id: userId },
        data: { notificationPreferences: {} },
      });
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await Promise.all(
        Array.from({ length: 2 }, (_, index) =>
          users.setNotificationPreference({
            id: userId,
            topic: `topic-${index}` as "langy",
            choice: "enabled",
          }),
        ),
      );

      const stored = await users.findNotificationPreferences(userId);
      expect(Object.keys(stored)).toHaveLength(2);
    });
  });
});
