// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  fanoutSsoDomainProofNotificationSchema,
  type SendSsoDomainProofNotification,
  sendSsoDomainProofNotificationSchema,
} from "@ee/event-sourcing/pipelines/sso-connections/process-manager/sso-domain-proof-notification.process";
import { generate } from "@langwatch/ksuid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import * as emailProviders from "~/server/mailer/providers";
import type {
  EmailContent,
  EmailProviderPort,
} from "~/server/mailer/providers/types";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { PrismaSsoDomainProofNotificationPort } from "../sso-self-serve-adapters";

const namespace = generate("ssoproofmail").toString();
const organizationId = `${namespace}-org`;
const adminA = `${namespace}-admin-a`;
const adminB = `${namespace}-admin-b`;
const adminC = `${namespace}-admin-c`;
const connectionId = `${namespace}-connection`;
const domain = `${namespace.replaceAll("_", "-").toLowerCase()}.test`;
const emailA = `admin-a@${domain}`;
const emailB = `admin-b@${domain}`;
const emailC = `admin-c@${domain}`;
const reassignedEmail = `reassigned-a@${domain}`;
const notificationId = `sso-domain-proof:wavering:${connectionId}:${domain}:1`;
const ref = {
  processName: "ssoDomainProofNotification",
  projectId: organizationId,
  processKey: `notification:${notificationId}`,
} as const;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const store = new PrismaProcessStore(prisma);
const port = new PrismaSsoDomainProofNotificationPort(prisma, store);
const providerSend = vi.fn(
  async ({
    content: _content,
  }: {
    content: EmailContent;
    defaultFrom: string;
  }) => undefined,
);
const provider: EmailProviderPort = { name: "smtp", send: providerSend };
vi.spyOn(emailProviders, "resolveEmailProvider").mockReturnValue(provider);

const notification = {
  kind: "wavering" as const,
  notificationId,
  connectionId,
  organizationId,
  domain,
  graceEndsAtMs: Date.now() + 48 * 60 * 60 * 1000,
};

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: organizationId, name: "Acme", slug: organizationId },
  });
  await prisma.user.createMany({
    data: [
      { id: adminA, name: "Admin A", email: emailA },
      { id: adminB, name: "Admin B", email: emailB },
      { id: adminC, name: "Admin C", email: emailC },
    ],
  });
  await prisma.organizationUser.createMany({
    data: [
      { organizationId, userId: adminA, role: "ADMIN" },
      { organizationId, userId: adminB, role: "ADMIN" },
    ],
  });
});

beforeEach(async () => {
  providerSend.mockReset();
  await prisma.processManagerOutbox.deleteMany({
    where: { processName: ref.processName, projectId: organizationId },
  });
  await prisma.user.updateMany({
    where: { id: { in: [adminA, adminB, adminC] } },
    data: { emailVerified: true },
  });
  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: "Acme" },
  });
  await prisma.user.update({
    where: { id: adminA },
    data: { email: emailA },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId, userId: adminC },
  });
});

afterAll(async () => {
  await prisma.processManagerOutbox.deleteMany({
    where: { processName: ref.processName, projectId: organizationId },
  });
  await prisma.organizationUser.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({
    where: { id: { in: [adminA, adminB, adminC] } },
  });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

async function pendingMessages() {
  return (await store.findMessagesByRef({ ref })).filter(
    (message) => message.status === "pending",
  );
}

async function dispatchPendingSends(now: number): Promise<string[]> {
  const leased = await store.leaseDueMessages({
    now,
    limit: 10,
    leaseDurationMs: 60_000,
    processNames: [ref.processName],
  });
  for (const message of leased) {
    const identity = {
      processName: message.processName,
      projectId: message.projectId,
      messageKey: message.messageKey,
    };
    if (message.intentType !== "send") {
      await store.markDispatched({
        identity,
        leaseToken: message.leaseToken,
        now,
      });
      continue;
    }
    try {
      await port.send(
        sendSsoDomainProofNotificationSchema.parse(message.payload),
      );
      await store.markDispatched({
        identity,
        leaseToken: message.leaseToken,
        now,
      });
    } catch {
      await store.markFailed({
        identity,
        leaseToken: message.leaseToken,
        now,
        nextAttemptAt: now + 1,
        dead: false,
      });
    }
  }
  return leased.map((message) => message.messageKey);
}

describe("SSO domain proof notification outbox", () => {
  /** @scenario "The administrators are told when the record goes, and again when it is too late" */
  it("persists one immutable fanout and independently retries recipients", async () => {
    await port.prepare(notification);

    await prisma.organization.update({
      where: { id: organizationId },
      data: { name: "Changed Acme" },
    });
    await prisma.organizationUser.create({
      data: { organizationId, userId: adminC, role: "ADMIN" },
    });
    await port.prepare(notification);

    const firstFanout = (await pendingMessages()).find(
      (message) => message.intentType === "fanout",
    );
    if (!firstFanout) throw new Error("fanout was not persisted");
    const fanoutPayload = fanoutSsoDomainProofNotificationSchema.parse(
      firstFanout.payload,
    );
    expect(fanoutPayload.deliveries).toHaveLength(2);
    expect(fanoutPayload.deliveries[0]?.content.html).toContain("Acme");
    expect(fanoutPayload.deliveries[0]?.content.html).not.toContain(
      "Changed Acme",
    );

    await port.fanout(fanoutPayload);
    await port.fanout(fanoutPayload);
    const persisted = await pendingMessages();
    expect(
      persisted.filter((message) => message.intentType === "send"),
    ).toHaveLength(2);

    let failedB = false;
    providerSend.mockImplementation(
      async ({ content }: { content: EmailContent; defaultFrom: string }) => {
        if (content.to === emailB && !failedB) {
          failedB = true;
          throw new Error("temporary SMTP failure");
        }
      },
    );

    const liveAdmins = await prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: "ADMIN",
        disabledAt: null,
        user: { deactivatedAt: null },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    expect(liveAdmins.map(({ userId }) => userId)).toEqual(
      expect.arrayContaining([adminB]),
    );
    const now = Date.now();
    const firstLeased = await dispatchPendingSends(now);
    expect(firstLeased).toHaveLength(3);
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(
      providerSend.mock.calls.map(([args]) => args.content.to).sort(),
    ).toEqual([emailA, emailB].sort());

    await dispatchPendingSends(now + 2);
    expect(providerSend).toHaveBeenCalledTimes(3);
    expect(providerSend.mock.calls[2]?.[0]?.content).toMatchObject({
      to: emailB,
    });

    await prisma.user.update({
      where: { id: adminA },
      data: { email: reassignedEmail },
    });
    const adminADelivery = await finalMessagesFor(ref, adminA);
    await port.send(adminADelivery);
    expect(providerSend).toHaveBeenCalledTimes(3);

    const finalMessages = await store.findMessagesByRef({ ref });
    expect(
      finalMessages.filter((message) => message.intentType === "send"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageKey: `send:${notificationId}:${adminA}`,
          status: "dispatched",
        }),
        expect.objectContaining({
          messageKey: `send:${notificationId}:${adminB}`,
          status: "dispatched",
          attempts: 2,
        }),
      ]),
    );
  });
});

async function finalMessagesFor(
  processRef: typeof ref,
  recipientUserId: string,
): Promise<SendSsoDomainProofNotification> {
  const message = (await store.findMessagesByRef({ ref: processRef })).find(
    (candidate) =>
      candidate.intentType === "send" &&
      candidate.messageKey.endsWith(`:${recipientUserId}`),
  );
  if (!message) throw new Error("recipient delivery was not persisted");
  return sendSsoDomainProofNotificationSchema.parse(message.payload);
}
