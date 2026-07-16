/**
 * @vitest-environment node
 *
 * Integration test for the ADR-040 §6 delivery log against REAL Postgres:
 * proves the `WebhookDelivery.triggerId` foreign key CASCADES — deleting the
 * owning Trigger removes its delivery rows — by EXECUTING the delete and
 * observing the rows disappear, not by asserting on the migration string.
 * (Regression guard for the review's "missing ON DELETE CASCADE" concern.)
 */
import { TriggerAction } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { PrismaWebhookDeliveryRepository } from "../webhook-delivery.prisma.repository";
import type { WebhookDeliveryInput } from "../webhook-delivery.repository";

const repo = new PrismaWebhookDeliveryRepository(prisma);
const TRIGGER_NAME = "webhook-delivery-cascade-integration";

let projectId: string;

async function createWebhookTrigger(): Promise<string> {
  const trigger = await prisma.trigger.create({
    data: {
      name: TRIGGER_NAME,
      projectId,
      action: TriggerAction.SEND_WEBHOOK,
      actionParams: { url: "https://example.com/hook" },
      filters: JSON.stringify({}),
    },
  });
  return trigger.id;
}

function delivery(triggerId: string): WebhookDeliveryInput {
  return {
    projectId,
    triggerId,
    dispatchId: "evt_cascade",
    requestMethod: "POST",
    requestUrl: "https://example.com/hook",
    requestHeaders: { Authorization: "***" },
    outcome: "success",
  };
}

beforeAll(async () => {
  const project = await getTestProject("webhook-delivery-cascade");
  projectId = project.id;
});

afterEach(async () => {
  await prisma.webhookDelivery.deleteMany({ where: { projectId } });
  await prisma.trigger.deleteMany({ where: { projectId, name: TRIGGER_NAME } });
});

describe("PrismaWebhookDeliveryRepository (real Postgres)", () => {
  describe("when the owning trigger is deleted after a delivery was recorded", () => {
    it("cascades the delete to its delivery rows", async () => {
      const triggerId = await createWebhookTrigger();
      await repo.create(delivery(triggerId));

      const before = await repo.findAllRecentByTriggerId({
        projectId,
        triggerId,
        limit: 10,
      });
      expect(before).toHaveLength(1);

      await prisma.trigger.delete({ where: { id: triggerId } });

      const orphaned = await prisma.webhookDelivery.count({
        where: { projectId, triggerId },
      });
      expect(orphaned).toBe(0);
    });
  });
});
