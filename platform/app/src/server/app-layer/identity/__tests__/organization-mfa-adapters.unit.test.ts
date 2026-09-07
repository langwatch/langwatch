import { beforeEach, describe, expect, it, vi } from "vitest";

const { error, prismaFake, sendRequirementEmail } = vi.hoisted(() => ({
  error: vi.fn(),
  prismaFake: {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn() },
  },
  sendRequirementEmail: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ error }),
}));
vi.mock("~/server/db", () => ({ prisma: prismaFake }));
vi.mock("~/server/mailer/organization-mfa-requirement-email", () => ({
  sendOrganizationMfaRequirementEmail: sendRequirementEmail,
}));

import { prisma } from "~/server/db";
import { EmailOrganizationMfaNotifier } from "../organization-mfa-adapters";

describe("EmailOrganizationMfaNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaFake.organization.findUnique.mockResolvedValue({ name: "Acme" });
    prismaFake.user.findUnique.mockResolvedValue({
      name: "Ana Admin",
      email: "ana@example.com",
    });
    prismaFake.organizationUser.findMany.mockResolvedValue([
      { userId: "ana", user: { email: "ana@example.com" } },
      { userId: "olga", user: { email: "olga@example.com" } },
    ]);
    sendRequirementEmail.mockResolvedValue(undefined);
  });

  /** @scenario "Turning the requirement on is recorded with who did it" */
  it("delivers the change to every active member returned for this organization", async () => {
    const notifier = new EmailOrganizationMfaNotifier(prisma);

    await notifier.requirementChanged({
      organizationId: "org-acme",
      actorUserId: "ana",
      required: true,
      memberUserIds: ["ana", "olga", "olga"],
    });

    expect(prismaFake.organizationUser.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-acme",
        userId: { in: ["ana", "olga"] },
        disabledAt: null,
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    expect(sendRequirementEmail).toHaveBeenCalledTimes(2);
    expect(sendRequirementEmail).toHaveBeenCalledWith({
      to: "ana@example.com",
      organizationName: "Acme",
      actorName: "Ana Admin",
      required: true,
    });
    expect(sendRequirementEmail).toHaveBeenCalledWith({
      to: "olga@example.com",
      organizationName: "Acme",
      actorName: "Ana Admin",
      required: true,
    });
  });

  it("attempts every delivery and reports failures without claiming success", async () => {
    sendRequirementEmail
      .mockRejectedValueOnce(new Error("mailbox refused"))
      .mockResolvedValueOnce(undefined);
    const notifier = new EmailOrganizationMfaNotifier(prisma);

    await expect(
      notifier.requirementChanged({
        organizationId: "org-acme",
        actorUserId: "ana",
        required: false,
        memberUserIds: ["ana", "olga"],
      }),
    ).rejects.toThrow("failed to notify 1 organization member");

    expect(sendRequirementEmail).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      {
        organizationId: "org-acme",
        actorUserId: "ana",
        required: false,
        attempted: 2,
        failed: 1,
      },
      "organization MFA requirement notification delivery failed",
    );
  });
});
