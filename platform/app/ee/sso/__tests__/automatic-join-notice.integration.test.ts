import { generate } from "@langwatch/ksuid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import { EmailJoinRequestNotifier } from "~/server/app-layer/identity/join-request-adapters";
import { createIdentityMigrationFixture } from "~/server/app-layer/system-migrations/__tests__/identity-migration.fixture";
import type { sendDomainAutoJoinedEmail } from "~/server/mailer/joinRequestEmails";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { SsoArrivalService } from "../sso-arrival.service";
import { PrismaSsoMembershipRepository } from "../sso-membership.prisma.repository";

const { sendNotice } = vi.hoisted(() => ({
  sendNotice: vi.fn<typeof sendDomainAutoJoinedEmail>(),
}));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  joinRequests: vi.fn(),
}));
vi.mock("~/server/mailer/joinRequestEmails", () => ({
  sendDomainAutoJoinedEmail: sendNotice,
  sendJoinRequestApprovedEmail: vi.fn(),
  sendJoinRequestArrivedEmail: vi.fn(),
  sendJoinRequestExpiredEmail: vi.fn(),
  sendJoinRequestRejectedEmail: vi.fn(),
  sendJoinRequestReminderEmail: vi.fn(),
}));

const namespace = generate("joinmail").toString();
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other`;
const domain = `${namespace}.test`;
const userId = (name: string) => `${namespace}-${name}`;
const email = (name: string) => `${name}@${domain}`;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const notifier = new EmailJoinRequestNotifier(prisma);
const announce = () =>
  notifier.joinedAutomatically({
    organizationId,
    requesterUserId: userId("sam"),
    domain,
  });

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { id: organizationId, name: "Acme", slug: organizationId },
      { id: otherOrganizationId, name: "Other", slug: otherOrganizationId },
    ],
  });
  await prisma.user.createMany({
    data: [
      "ana",
      "ivan",
      "disabled",
      "member",
      "foreign",
      "sam",
      "arrival",
    ].map((name) => ({ id: userId(name), name, email: email(name) })),
  });
  await prisma.organizationUser.createMany({
    data: [
      { userId: userId("ana"), organizationId, role: "ADMIN" },
      { userId: userId("ivan"), organizationId, role: "ADMIN" },
      {
        userId: userId("disabled"),
        organizationId,
        role: "ADMIN",
        disabledAt: new Date(),
      },
      { userId: userId("member"), organizationId, role: "MEMBER" },
      { userId: userId("sam"), organizationId, role: "MEMBER" },
      {
        userId: userId("foreign"),
        organizationId: otherOrganizationId,
        role: "ADMIN",
      },
    ],
  });
});
beforeEach(() => {
  sendNotice.mockReset().mockResolvedValue();
});
afterEach(async () => {
  await prisma.organizationUser.deleteMany({
    where: { organizationId, userId: userId("arrival") },
  });
});
afterAll(async () => {
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: namespace } } });
  await prisma.organization.deleteMany({
    where: { id: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.$disconnect();
});

describe("automatic-join notices over persisted memberships", () => {
  /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
  it("emails only the joined organization's live administrators", async () => {
    await announce();

    expect(
      sendNotice.mock.calls.map(([args]) => args.adminEmail).sort(),
    ).toEqual([email("ana"), email("ivan")].sort());
    for (const [args] of sendNotice.mock.calls) {
      expect(args).toMatchObject({
        organizationName: "Acme",
        memberName: "sam",
        domain,
      });
    }
  });

  /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
  it("attempts the other administrator when one delivery fails", async () => {
    sendNotice.mockImplementation(async ({ adminEmail }) => {
      if (adminEmail === email("ana")) throw new Error("Mailbox unavailable");
    });

    await expect(announce()).resolves.toBeUndefined();

    expect(
      sendNotice.mock.calls.map(([args]) => args.adminEmail).sort(),
    ).toEqual([email("ana"), email("ivan")].sort());
  });
});

describe("automatic SSO notices behind the persisted membership insert", () => {
  for (const schedule of ["repeat", "concurrent"]) {
    /** @scenario "Repeated or concurrent SSO arrivals announce only the new membership" */
    it(`notifies each live administrator once for ${schedule} joins`, async () => {
      const attachBindings = vi.fn().mockResolvedValue(void 0);
      const service = new SsoArrivalService({
        migrations: createIdentityMigrationFixture().service,
        connections: { findConnectionForSignIn: async () => null },
        memberships: new PrismaSsoMembershipRepository(prisma),
        invites: { applyPendingInvite: async () => null },
        joinRequests: { requestFromSsoArrival: async () => null },
        grants: { attachBindings },
        notifications: {
          joinedAutomatically: (args) => notifier.joinedAutomatically(args),
          announceSignup: vi.fn(),
          startNurturing: vi.fn(),
        },
      });
      const join = () =>
        service.joinOrganization({
          user: {
            id: userId("arrival"),
            name: "arrival",
            email: email("arrival"),
          },
          org: { id: organizationId, name: "Acme" },
          domain,
        });

      if (schedule === "concurrent") {
        await Promise.all([join(), join()]);
      } else {
        await join();
        await join();
      }

      expect(
        await prisma.organizationUser.count({
          where: { organizationId, userId: userId("arrival") },
        }),
      ).toBe(1);
      expect(attachBindings).toHaveBeenCalledTimes(2);
      expect(
        sendNotice.mock.calls.map(([args]) => args.adminEmail).sort(),
      ).toEqual([email("ana"), email("ivan")].sort());
    });
  }
});
