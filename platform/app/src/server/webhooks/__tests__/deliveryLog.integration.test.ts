import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaWebhookDeliveryRepository } from "~/server/app-layer/automations/repositories/webhook-delivery.prisma.repository";
import { prisma } from "~/server/db";
import {
  pruneExpiredIdempotencyReceipts,
  pruneWebhookDeliveries,
  WEBHOOK_DELIVERY_RETENTION_MS,
} from "../deliveryLog";

/**
 * The two webhook channels share one delivery log. This exercises that against
 * the real table: both channels write into it, each reads back only its own,
 * and the one retention sweep clears both. Before the merge these were two
 * tables with two prune implementations, so a sweep that only cleared one of
 * them looked identical to a passing test.
 */

const ns = `delivery-log-${nanoid(8)}`;

let projectId: string;
let triggerId: string;
let organizationId: string;
let endpointId: string;
let teamId: string;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "Delivery Log Org", slug: `--test-org-${ns}` },
  });
  organizationId = organization.id;
  const team = await prisma.team.create({
    data: {
      name: "Delivery Log Team",
      slug: `--test-team-${ns}`,
      organizationId,
    },
  });
  teamId = team.id;
  const project = await prisma.project.create({
    data: {
      name: "Delivery Log Project",
      slug: `--test-project-${ns}`,
      apiKey: `test-${ns}`,
      teamId,
      language: "other",
      framework: "other",
    },
  });
  projectId = project.id;
  const trigger = await prisma.trigger.create({
    data: {
      name: "Delivery Log Trigger",
      projectId,
      action: "SEND_WEBHOOK",
      filters: {},
      actionParams: {},
    },
  });
  triggerId = trigger.id;
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: `webhookendpoint_${nanoid(12)}`,
      organizationId,
      url: "https://example.com/hooks/shared-log",
      enabledEvents: ["gateway.request.completed"],
      secretEncrypted: "not-a-real-secret",
    },
  });
  endpointId = endpoint.id;
});

afterAll(async () => {
  await prisma.webhookEndpointDelivery.deleteMany({ where: { projectId } });
  await prisma.webhookEndpointDelivery.deleteMany({
    where: { organizationId },
  });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId } });
  await prisma.trigger.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
  await prisma.team.delete({ where: { id: teamId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

const writeAutomationsRow = (firedAt: Date, dispatchId: string) =>
  prisma.webhookEndpointDelivery.create({
    data: {
      channel: "automations",
      projectId,
      triggerId,
      dispatchId,
      outcome: "success",
      responseStatus: 200,
      latencyMs: 12,
      firedAt,
    },
  });

const writePlatformRow = (firedAt: Date, dispatchId: string) =>
  prisma.webhookEndpointDelivery.create({
    data: {
      channel: "platform",
      organizationId,
      endpointId,
      dispatchId,
      attempt: 1,
      eventCount: 3,
      outcome: "success",
      responseStatus: 200,
      latencyMs: 30,
      firedAt,
    },
  });

describe("the shared webhook delivery log", () => {
  describe("when both channels have written attempts", () => {
    it("keeps each channel's tenancy columns and leaves the other's null", async () => {
      const now = new Date();
      await writeAutomationsRow(now, `evt_${ns}_shape`);
      await writePlatformRow(now, `btch_${ns}_shape`);

      const automationsRow =
        await prisma.webhookEndpointDelivery.findFirstOrThrow({
          where: { projectId, dispatchId: `evt_${ns}_shape` },
        });
      expect(automationsRow.channel).toBe("automations");
      expect(automationsRow.organizationId).toBeNull();
      expect(automationsRow.endpointId).toBeNull();
      // Neither is recorded by the automations sender; a back-filled 1 would
      // be a claim it never made.
      expect(automationsRow.attempt).toBeNull();
      expect(automationsRow.eventCount).toBeNull();

      const platformRow = await prisma.webhookEndpointDelivery.findFirstOrThrow(
        {
          where: { organizationId, dispatchId: `btch_${ns}_shape` },
        },
      );
      expect(platformRow.channel).toBe("platform");
      expect(platformRow.projectId).toBeNull();
      expect(platformRow.triggerId).toBeNull();
      expect(platformRow.eventCount).toBe(3);
    });

    it("serves the automations drawer only its own rows", async () => {
      const now = new Date();
      await writeAutomationsRow(now, `evt_${ns}_read`);
      await writePlatformRow(now, `btch_${ns}_read`);

      const rows = await new PrismaWebhookDeliveryRepository(
        prisma,
      ).findAllRecentByTriggerId({ projectId, triggerId, limit: 50 });

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.dispatchId)).toContain(`evt_${ns}_read`);
      expect(rows.map((r) => r.dispatchId)).not.toContain(`btch_${ns}_read`);
      for (const row of rows) {
        expect(row.triggerId).toBe(triggerId);
      }
    });
  });

  describe("the retention sweep", () => {
    it("clears expired rows of BOTH channels in one pass", async () => {
      const now = new Date();
      const expired = new Date(
        now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS - DAY_MS,
      );
      await writeAutomationsRow(expired, `evt_${ns}_old`);
      await writePlatformRow(expired, `btch_${ns}_old`);
      await writeAutomationsRow(now, `evt_${ns}_fresh`);
      await writePlatformRow(now, `btch_${ns}_fresh`);

      await pruneWebhookDeliveries({ prisma, now });

      // Read each channel back through its own tenancy anchor; the guard
      // refuses an unscoped read of the shared log, which is the point.
      const automationsSurvivors =
        await prisma.webhookEndpointDelivery.findMany({
          where: {
            projectId,
            dispatchId: { in: [`evt_${ns}_old`, `evt_${ns}_fresh`] },
          },
          select: { dispatchId: true },
        });
      const platformSurvivors = await prisma.webhookEndpointDelivery.findMany({
        where: {
          organizationId,
          dispatchId: { in: [`btch_${ns}_old`, `btch_${ns}_fresh`] },
        },
        select: { dispatchId: true },
      });
      expect(automationsSurvivors.map((r) => r.dispatchId)).toEqual([
        `evt_${ns}_fresh`,
      ]);
      expect(platformSurvivors.map((r) => r.dispatchId)).toEqual([
        `btch_${ns}_fresh`,
      ]);
    });
  });
});

describe("the idempotency receipt sweep", () => {
  describe("when a receipt's window has closed", () => {
    it("deletes it and leaves live receipts alone", async () => {
      const now = new Date();
      const scopeId = `scope_${ns}`;
      await prisma.idempotencyReceipt.create({
        data: {
          scopeId,
          key: `expired_${ns}`,
          requestFingerprint: "fp",
          expiresAt: new Date(now.getTime() - 1000),
        },
      });
      await prisma.idempotencyReceipt.create({
        data: {
          scopeId,
          key: `live_${ns}`,
          requestFingerprint: "fp",
          expiresAt: new Date(now.getTime() + DAY_MS),
        },
      });

      await pruneExpiredIdempotencyReceipts({ prisma, now });

      const remaining = await prisma.idempotencyReceipt.findMany({
        where: { scopeId },
        select: { key: true },
      });
      expect(remaining.map((r) => r.key)).toEqual([`live_${ns}`]);

      await prisma.idempotencyReceipt.deleteMany({ where: { scopeId } });
    });
  });
});
