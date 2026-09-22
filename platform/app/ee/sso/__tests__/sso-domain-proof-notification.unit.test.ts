// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @vitest-environment node */

import type { SendSsoDomainProofNotification } from "@ee/event-sourcing/pipelines/sso-connections/process-manager/sso-domain-proof-notification.process";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, PrismaClient } from "~/generated/prisma/client";
import { InMemoryProcessStore } from "~/server/event-sourcing/process-manager/stores/inMemoryProcessStore";
import { sendEmail } from "~/server/mailer/emailSender";
import { PrismaSsoDomainProofNotificationPort } from "../sso-self-serve-adapters";

vi.mock("~/server/mailer/emailSender", () => ({
  sendEmail: vi.fn(),
}));

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: "postgresql://test:test@127.0.0.1:1/test",
  }),
});
const findFirst = vi.spyOn(prisma.organizationUser, "findFirst");
const processStore = new InMemoryProcessStore();
const port = new PrismaSsoDomainProofNotificationPort(prisma, processStore);
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const notification: SendSsoDomainProofNotification = {
  notificationId: "sso-domain-proof:wavering:connection_acme:acme.test:1",
  organizationId: "org_acme",
  recipientUserId: "user_admin",
  content: {
    idempotencyKey: "notification:user_admin",
    to: "admin@acme.test",
    subject: "Domain proof",
    html: "<p>snapshot</p>",
    from: "LangWatch <noreply@langwatch.ai>",
  },
};

describe("SSO domain proof notification delivery", () => {
  /** @scenario "The administrators are told when the record goes, and again when it is too late" */
  it("does not send a persisted snapshot after the user changes email", async () => {
    const membership = {
      userId: notification.recipientUserId,
      organizationId: notification.organizationId,
      role: OrganizationUserRole.ADMIN,
      createdAt: new Date(),
      updatedAt: new Date(),
      departmentId: null,
      disabledAt: null,
      pendingSsoGrantId: null,
      membershipStamp: "membership_stamp",
      user: { email: "new-admin@acme.test" },
    };
    findFirst.mockResolvedValue(membership);

    await port.send(notification);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: notification.organizationId,
        userId: notification.recipientUserId,
        role: "ADMIN",
        disabledAt: null,
        user: { deactivatedAt: null },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
  });

  it("allows a case-only email representation change for the same address", async () => {
    const membership = {
      userId: notification.recipientUserId,
      organizationId: notification.organizationId,
      role: OrganizationUserRole.ADMIN,
      createdAt: new Date(),
      updatedAt: new Date(),
      departmentId: null,
      disabledAt: null,
      pendingSsoGrantId: null,
      membershipStamp: "membership_stamp",
      user: { email: " ADMIN@ACME.TEST " },
    };
    findFirst.mockResolvedValue(membership);

    await port.send(notification);

    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(notification.content);
  });
});
