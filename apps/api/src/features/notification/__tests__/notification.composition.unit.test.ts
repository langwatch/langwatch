/**
 * The durable notification record, served by the API process.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { installApiNotification } from "../notification.composition.ts";

const SENT_AT = new Date("2026-08-25T00:00:00.000Z");
const SINCE = new Date("2026-08-24T00:00:00.000Z");

const row = {
  id: "notification-1",
  organizationId: "organization-1",
  projectId: null,
  metadata: { kind: "usage-limit" },
  createdAt: SENT_AT,
  updatedAt: SENT_AT,
  sentAt: SENT_AT,
};

/** The one table this feature owns, recorded as the process would write it. */
function testPrisma() {
  const written: Record<string, unknown>[] = [];

  const prisma = {
    notification: {
      create: vi.fn<(input: { data: Record<string, unknown> }) => Promise<typeof row>>(
        async ({ data }) => {
          written.push(data);

          return row;
        },
      ),
      findMany: vi.fn<() => Promise<(typeof row)[]>>(async () => [row]),
    },
  } as unknown as PrismaClient;

  return { prisma, written };
}

describe("installApiNotification", () => {
  describe("given the process composed a database", () => {
    it("writes a record and reads an organization's recent records back", async () => {
      const { prisma, written } = testPrisma();

      const { app } = await installApiNotification({ infrastructure: { prisma } });

      await expect(
        app.create({
          organizationId: "organization-1",
          metadata: { kind: "usage-limit" },
          sentAt: SENT_AT,
        }),
      ).resolves.toMatchObject({ id: "notification-1" });

      expect(written).toEqual([
        {
          organizationId: "organization-1",
          projectId: undefined,
          metadata: { kind: "usage-limit" },
          sentAt: SENT_AT,
        },
      ]);

      await expect(
        app.listRecentByOrganization({ organizationId: "organization-1", since: SINCE }),
      ).resolves.toEqual([row]);
    });
  });
});
