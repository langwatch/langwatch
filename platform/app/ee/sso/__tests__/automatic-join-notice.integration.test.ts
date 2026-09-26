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
import { AuthzGrantNotConfirmedError } from "~/server/app-layer/authz/errors";
import { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import {
  EmailJoinRequestNotifier,
  JoinRequestLifecycleDispatcher,
  PrismaJoinMembership,
} from "~/server/app-layer/identity/join-request-adapters";
import { createIdentityMigrationFixture } from "~/server/app-layer/system-migrations/__tests__/identity-migration.fixture";
import { AUTHZ_GRANT_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import {
  joinRequestNotificationDeliverySchema,
  joinRequestNotificationFanoutSchema,
  remindAdminsIntentSchema,
  runRemindAdmins,
} from "~/server/event-sourcing/pipelines/join-requests/process-manager/joinRequestLifecycle.process";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import type { SsoArrivalGrantsPort } from "../sso-arrival.service";
import { SsoArrivalService } from "../sso-arrival.service";
import { PrismaSsoMembershipRepository } from "../sso-membership.prisma.repository";

const { renderNotice, renderReminder, sendNotice } = vi.hoisted(() => ({
  renderNotice: vi.fn(
    async (
      { adminEmail }: { adminEmail: string } = {
        adminEmail: "missing@example.com",
      },
    ) => ({
      to: adminEmail,
      subject: "Automatic join",
      html: "html",
    }),
  ),
  renderReminder: vi.fn(async ({ adminEmail }: { adminEmail: string }) => ({
    to: adminEmail,
    subject: "Reminder",
    html: "reminder",
  })),
  sendNotice: vi.fn(async (_content: unknown) => undefined),
}));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  joinRequests: vi.fn(),
}));
vi.mock("~/server/mailer/joinRequestEmails", () => ({
  renderDomainAutoJoinedEmail: renderNotice,
  renderJoinRequestReminderEmail: renderReminder,
}));
vi.mock("~/server/mailer/emailSender", async () => ({
  ...(await vi.importActual<typeof import("~/server/mailer/emailSender")>(
    "~/server/mailer/emailSender",
  )),
  sendEmail: sendNotice,
}));

const namespace = generate("joinmail").toString();
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other`;
const domain = `${namespace.replaceAll("_", "-").toLowerCase()}.test`;
const userId = (name: string) => `${namespace}-${name}`;
const email = (name: string) => `${name}@${domain}`;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const completionClientNames = [
  `${namespace}-first`,
  `${namespace}-second`,
] as const;
const createCompletionClient = (applicationName: string) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("application_name", applicationName);
  return new PrismaClient({ adapter: createPrismaPgAdapter(url.toString()) });
};
const casClients = [
  createCompletionClient(`${namespace}-locker`),
  createCompletionClient(completionClientNames[0]),
  createCompletionClient(completionClientNames[1]),
] as const;
const notifier = new EmailJoinRequestNotifier(
  prisma,
  new PrismaProcessStore(prisma),
);
const eventSourcing = createAuthzTestEventSourcing(prisma);
const writer = new GrantsLedgerWriter(prisma, {
  commands: async () => eventSourcing.getPipeline(AUTHZ_GRANT_PIPELINE_NAME),
});
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
  await prisma.grant.create({
    data: {
      id: `${namespace}-sam-grant`,
      organizationId,
      principalType: "USER",
      principalId: userId("sam"),
      roleKey: "member",
      source: "join-request",
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      occurredAt: new Date(),
    },
  });
});
beforeEach(() => {
  renderNotice.mockClear();
  renderReminder.mockClear();
  sendNotice.mockReset();
});
afterEach(async () => {
  await prisma.joinRequest.deleteMany({
    where: { id: { startsWith: namespace } },
  });
  await prisma.processManagerOutbox.deleteMany({
    where: { processName: "joinRequestLifecycle", projectId: organizationId },
  });
  await prisma.processManagerInstance.deleteMany({
    where: { processName: "joinRequestLifecycle", projectId: organizationId },
  });
  await prisma.roleBinding.deleteMany({
    where: { organizationId, userId: userId("arrival") },
  });
  await prisma.grant.deleteMany({
    where: { organizationId, principalId: userId("arrival") },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId, userId: userId("arrival") },
  });
});
afterAll(async () => {
  await eventSourcing.close();
  await prisma.grant.deleteMany({ where: { organizationId } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: namespace } } });
  await prisma.organization.deleteMany({
    where: { id: { in: [organizationId, otherOrganizationId] } },
  });
  await Promise.all(casClients.map((client) => client.$disconnect()));
  await prisma.$disconnect();
});

describe("automatic-join notices over persisted memberships", () => {
  /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
  it("persists only the joined organization's live administrators", async () => {
    await announce();

    const messages = await new PrismaProcessStore(prisma).findMessagesByRef({
      ref: {
        processName: "joinRequestLifecycle",
        projectId: organizationId,
        processKey: `automatic:${organizationId}:${userId("sam")}:${domain}`,
      },
    });
    const [fanout] = messages.filter(
      (message) => message.intentType === "fanoutNotification",
    );
    expect(fanout?.payload).toMatchObject({
      kind: "joinedAutomatically",
      organizationId,
      messages: [
        expect.objectContaining({ recipientUserId: userId("ana") }),
        expect.objectContaining({ recipientUserId: userId("ivan") }),
      ],
    });
    expect(renderNotice).toHaveBeenCalledTimes(2);
    expect(renderNotice.mock.calls.map(([args]) => args?.adminEmail)).toEqual([
      email("ana"),
      email("ivan"),
    ]);
  });

  /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
  it("snapshots each administrator as an independent outbox delivery", async () => {
    await announce();
    const store = new PrismaProcessStore(prisma);
    const ref = {
      processName: "joinRequestLifecycle",
      projectId: organizationId,
      processKey: `automatic:${organizationId}:${userId("sam")}:${domain}`,
    } as const;
    const [fanout] = (await store.findMessagesByRef({ ref })).filter(
      (message) => message.intentType === "fanoutNotification",
    );
    if (!fanout) throw new Error("automatic join fanout was not persisted");

    await notifier.fanoutNotification({
      payload: joinRequestNotificationFanoutSchema.parse(fanout.payload),
      context: {
        ...ref,
        tenantId: organizationId,
        messageKey: fanout.messageKey,
        attempt: 1,
      },
    });
    await notifier.fanoutNotification({
      payload: joinRequestNotificationFanoutSchema.parse(fanout.payload),
      context: {
        ...ref,
        tenantId: organizationId,
        messageKey: fanout.messageKey,
        attempt: 2,
      },
    });

    const deliveries = (await store.findMessagesByRef({ ref })).filter(
      (message) => message.intentType === "sendNotification",
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((message) => message.userId).sort()).toEqual([
      userId("ana"),
      userId("ivan"),
    ]);
  });

  /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
  it("retries one failed recipient without changing the other delivery", async () => {
    await announce();
    const store = new PrismaProcessStore(prisma);
    const ref = {
      processName: "joinRequestLifecycle",
      projectId: organizationId,
      processKey: `automatic:${organizationId}:${userId("sam")}:${domain}`,
    } as const;
    const [fanout] = (await store.findMessagesByRef({ ref })).filter(
      (message) => message.intentType === "fanoutNotification",
    );
    if (!fanout) throw new Error("automatic join fanout was not persisted");

    await notifier.fanoutNotification({
      payload: joinRequestNotificationFanoutSchema.parse(fanout.payload),
      context: {
        ...ref,
        tenantId: organizationId,
        messageKey: fanout.messageKey,
        attempt: 1,
      },
    });
    const deliveries = (await store.findMessagesByRef({ ref }))
      .filter((message) => message.intentType === "sendNotification")
      .sort((left, right) => left.userId!.localeCompare(right.userId!));
    expect(deliveries).toHaveLength(2);
    expect(new Set(deliveries.map((message) => message.messageKey)).size).toBe(
      2,
    );
    const deliveryPayloads = deliveries.map((message) =>
      joinRequestNotificationDeliverySchema.parse(message.payload),
    );
    const originalContents = deliveryPayloads.map(({ content }) => content);

    sendNotice.mockRejectedValueOnce(new Error("temporary mail failure"));
    await expect(
      notifier.sendNotification(deliveryPayloads[0]!),
    ).rejects.toThrow("temporary mail failure");
    await notifier.sendNotification(deliveryPayloads[1]!);
    await notifier.sendNotification(deliveryPayloads[0]!);

    expect(sendNotice).toHaveBeenCalledTimes(3);
    expect(sendNotice.mock.calls.map(([content]) => content)).toEqual([
      originalContents[0],
      originalContents[1],
      originalContents[0],
    ]);
    expect(
      new Set(originalContents.map(({ idempotencyKey }) => idempotencyKey))
        .size,
    ).toBe(2);
  });

  it("drops a reminder whose request is already terminal", async () => {
    const joinRequestId = `${namespace}-terminal-request`;
    const now = new Date();
    await prisma.joinRequest.create({
      data: {
        id: joinRequestId,
        userId: userId("sam"),
        organizationId,
        domain,
        state: "APPROVED",
        matchedVia: "verified-identifier-domain",
        resolvedAt: now,
        resolvedByType: "user",
        resolvedById: userId("ana"),
        occurredAt: now,
        acceptedAt: now,
        lastEventId: `${joinRequestId}-event`,
        projectionVersion: "1",
        createdAt: now,
        updatedAt: now,
      },
    });

    await notifier.prepareNotification({
      payload: {
        kind: "requestStillWaiting",
        notificationId: `join:${joinRequestId}:requestStillWaiting`,
        joinRequestId,
        organizationId,
        requesterUserId: userId("sam"),
        domain,
      },
      context: {
        attempt: 1,
        processName: "joinRequestLifecycle",
        projectId: organizationId,
        processKey: joinRequestId,
        tenantId: organizationId,
        messageKey: `join-notification:${joinRequestId}:requestStillWaiting`,
      },
    });

    await expect(
      prisma.processManagerOutbox.count({
        where: {
          processName: "joinRequestLifecycle",
          projectId: organizationId,
          intentType: "fanoutNotification",
        },
      }),
    ).resolves.toBe(0);
  });

  it("resolves an old reminder payload from the JoinRequest projection", async () => {
    const joinRequestId = `${namespace}-legacy-reminder`;
    const now = new Date();
    await prisma.joinRequest.create({
      data: {
        id: joinRequestId,
        userId: userId("sam"),
        organizationId,
        domain,
        state: "PENDING",
        matchedVia: "verified-identifier-domain",
        occurredAt: now,
        acceptedAt: now,
        lastEventId: `${joinRequestId}-event`,
        projectionVersion: "1",
        createdAt: now,
        updatedAt: now,
      },
    });

    await runRemindAdmins({
      port: new JoinRequestLifecycleDispatcher(
        notifier,
        new PrismaJoinMembership(prisma, writer),
      ),
    })(
      remindAdminsIntentSchema.parse({
        joinRequestId,
        organizationId,
        scheduledFor: now.getTime(),
      }),
      {
        processName: "joinRequestLifecycle",
        projectId: organizationId,
        processKey: joinRequestId,
        tenantId: organizationId,
        messageKey: `join-remind:${joinRequestId}`,
        attempt: 1,
      },
    );

    const messages = await new PrismaProcessStore(prisma).findMessagesByRef({
      ref: {
        processName: "joinRequestLifecycle",
        projectId: organizationId,
        processKey: joinRequestId,
      },
    });
    const fanout = messages.find(
      (message) => message.intentType === "fanoutNotification",
    );
    expect(fanout?.payload).toMatchObject({
      requesterUserId: userId("sam"),
      organizationId,
      kind: "requestStillWaiting",
    });
    expect(renderReminder.mock.calls.map(([args]) => args?.adminEmail)).toEqual(
      [email("ana"), email("ivan")],
    );
  });

  it("retries an approval notice until membership access is live", async () => {
    const joinRequestId = `${namespace}-approval-request`;
    const payload = {
      kind: "requestApproved" as const,
      joinRequestId,
      organizationId,
      requesterUserId: userId("arrival"),
      recipientUserId: userId("arrival"),
      isAdmin: false,
      content: {
        to: email("arrival"),
        subject: "Approved",
        html: "approved",
        from: "LangWatch <hello@langwatch.ai>",
        idempotencyKey: `${namespace}:approval:${userId("arrival")}`,
      },
    };
    await prisma.organizationUser.create({
      data: {
        userId: userId("arrival"),
        organizationId,
        role: "MEMBER",
      },
    });

    await expect(notifier.sendNotification(payload)).rejects.toThrow(
      AuthzGrantNotConfirmedError,
    );

    await prisma.grant.create({
      data: {
        id: `${namespace}-approval-grant`,
        organizationId,
        principalType: "USER",
        principalId: userId("arrival"),
        roleKey: "member",
        source: "join-request",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    await notifier.sendNotification(payload);

    expect(sendNotice).toHaveBeenCalledOnce();
  });
});

describe("automatic SSO notices behind the persisted membership insert", () => {
  for (const schedule of ["repeat", "concurrent"]) {
    /** @scenario "Repeated or concurrent SSO arrivals announce only the new membership" */
    it(`notifies each live administrator once for ${schedule} joins`, async () => {
      const attachBindings = vi.fn(writer.attachBindings.bind(writer));
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
      expect(attachBindings.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(attachBindings.mock.calls.length).toBeLessThanOrEqual(2);
      expect(
        await prisma.grant.count({
          where: {
            organizationId,
            principalId: userId("arrival"),
            revokedAt: null,
          },
        }),
      ).toBe(1);
      const fanouts = await prisma.processManagerOutbox.findMany({
        where: {
          processName: "joinRequestLifecycle",
          projectId: organizationId,
          intentType: "fanoutNotification",
        },
      });
      expect(fanouts).toHaveLength(1);
      expect(fanouts[0]?.payload).toMatchObject({
        messages: [
          expect.objectContaining({ recipientUserId: userId("ana") }),
          expect.objectContaining({ recipientUserId: userId("ivan") }),
        ],
      });
    });
  }

  /** @scenario "Concurrent SSO admission completion claims one notification" */
  it("claims a persisted admission once when completion updates overlap", async () => {
    const pendingGrantId = `${namespace}-cas-grant`;
    const [locker, first, second] = casClients;
    await Promise.all([first.$queryRaw`SELECT 1`, second.$queryRaw`SELECT 1`]);
    await prisma.organizationUser.create({
      data: {
        userId: userId("arrival"),
        organizationId,
        role: "MEMBER",
        pendingSsoGrantId: pendingGrantId,
      },
    });
    await prisma.grant.create({
      data: {
        id: pendingGrantId,
        organizationId,
        principalType: "USER",
        principalId: userId("arrival"),
        roleKey: "member",
        source: "join-request",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const lockTransaction = locker.$transaction(
      async (tx) => {
        await tx.$queryRaw`
        -- @tenancy: organization-scoped SSO admission CAS test lock
        SELECT "userId", "organizationId"
        FROM "OrganizationUser"
        WHERE "userId" = ${userId("arrival")}
          AND "organizationId" = ${organizationId}
        FOR UPDATE
      `;
        acquired.resolve();
        await release.promise;
      },
      { timeout: 15_000 },
    );
    await Promise.race([acquired.promise, lockTransaction]);
    const complete = (client: PrismaClient) =>
      new PrismaSsoMembershipRepository(client).completeAdmission({
        userId: userId("arrival"),
        organizationId,
        grantId: pendingGrantId,
      });
    const updates = Promise.allSettled([complete(first), complete(second)]);

    try {
      let activeUpdates = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name IN (${completionClientNames[0]}, ${completionClientNames[1]})
            AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()
            AND query ILIKE '%UPDATE%OrganizationUser%'
        `;
        activeUpdates = rows[0]?.count ?? 0;
        if (activeUpdates >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(activeUpdates).toBeGreaterThanOrEqual(2);
      release.resolve();
      const outcomes = await updates;
      expect(outcomes).toEqual(
        expect.arrayContaining([
          { status: "fulfilled", value: false },
          { status: "fulfilled", value: true },
        ]),
      );
    } finally {
      release.resolve();
      await Promise.all([lockTransaction, updates]);
    }
  });

  /** @scenario "Inactive members cannot complete pending SSO admission" */
  it("keeps a disabled or deactivated admission pending", async () => {
    const pendingGrantId = `${namespace}-guard-grant`;
    const repository = new PrismaSsoMembershipRepository(prisma);
    await prisma.organizationUser.create({
      data: {
        userId: userId("arrival"),
        organizationId,
        role: "MEMBER",
        disabledAt: new Date(),
        pendingSsoGrantId: pendingGrantId,
      },
    });

    expect(
      await repository.completeAdmission({
        userId: userId("arrival"),
        organizationId,
        grantId: pendingGrantId,
      }),
    ).toBe(false);

    await prisma.organizationUser.update({
      where: {
        userId_organizationId: { userId: userId("arrival"), organizationId },
      },
      data: { disabledAt: null },
    });
    await prisma.user.update({
      where: { id: userId("arrival") },
      data: { deactivatedAt: new Date() },
    });

    try {
      expect(
        await repository.completeAdmission({
          userId: userId("arrival"),
          organizationId,
          grantId: pendingGrantId,
        }),
      ).toBe(false);
      await expect(
        prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: userId("arrival"),
              organizationId,
            },
          },
          select: { pendingSsoGrantId: true },
        }),
      ).resolves.toEqual({ pendingSsoGrantId: pendingGrantId });
    } finally {
      await prisma.user.update({
        where: { id: userId("arrival") },
        data: { deactivatedAt: null },
      });
    }
  });

  /** @scenario "An SSO admission retry never restores revoked access" */
  it("clears a revoked admission marker without announcing access", async () => {
    const pendingGrantId = `${namespace}-revoked-grant`;
    await prisma.organizationUser.create({
      data: {
        userId: userId("arrival"),
        organizationId,
        role: "MEMBER",
        pendingSsoGrantId: pendingGrantId,
      },
    });
    await prisma.grant.create({
      data: {
        id: pendingGrantId,
        organizationId,
        principalType: "USER",
        principalId: userId("arrival"),
        roleKey: "member",
        source: "join-request",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
        revokedAt: new Date(),
      },
    });
    const joinedAutomatically = vi.fn();
    const service = new SsoArrivalService({
      migrations: createIdentityMigrationFixture().service,
      connections: { findConnectionForSignIn: async () => null },
      memberships: new PrismaSsoMembershipRepository(prisma),
      invites: { applyPendingInvite: async () => null },
      joinRequests: { requestFromSsoArrival: async () => null },
      grants: { attachBindings: vi.fn() },
      notifications: {
        joinedAutomatically,
        announceSignup: vi.fn(),
        startNurturing: vi.fn(),
      },
    });

    await service.joinOrganization({
      user: {
        id: userId("arrival"),
        name: "arrival",
        email: email("arrival"),
      },
      org: { id: organizationId, name: "Acme" },
      domain,
    });

    expect(joinedAutomatically).not.toHaveBeenCalled();
    await expect(
      prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: userId("arrival"),
            organizationId,
          },
        },
        select: { pendingSsoGrantId: true },
      }),
    ).resolves.toEqual({ pendingSsoGrantId: null });
  });

  /** @scenario "A later SSO sign-in completes a failed admission grant" */
  it("retries a persisted admission with the same grant identity", async () => {
    const attachBindings = vi
      .fn<SsoArrivalGrantsPort["attachBindings"]>()
      .mockRejectedValueOnce(new Error("ledger unavailable"))
      .mockImplementation((args) => writer.attachBindings(args));
    const announceSignup = vi.fn();
    const startNurturing = vi.fn();
    const service = new SsoArrivalService({
      migrations: createIdentityMigrationFixture().service,
      connections: { findConnectionForSignIn: async () => null },
      memberships: new PrismaSsoMembershipRepository(prisma),
      invites: { applyPendingInvite: async () => null },
      joinRequests: { requestFromSsoArrival: async () => null },
      grants: { attachBindings },
      notifications: {
        joinedAutomatically: (args) => notifier.joinedAutomatically(args),
        announceSignup,
        startNurturing,
      },
    });
    const user = {
      id: userId("arrival"),
      name: "arrival",
      email: email("arrival"),
    };
    const join = () =>
      service.joinOrganization({
        user,
        org: { id: organizationId, name: "Acme" },
        domain,
      });

    await expect(join()).rejects.toThrow("ledger unavailable");

    const pending = await prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      select: { pendingSsoGrantId: true },
    });
    expect(pending?.pendingSsoGrantId).toBeTruthy();
    const grantId = pending?.pendingSsoGrantId;
    if (!grantId)
      throw new Error(
        "the failed admission did not persist its grant identity",
      );

    await join();

    expect(attachBindings).toHaveBeenCalledTimes(2);
    expect(attachBindings.mock.calls[1]?.[0]).toEqual(
      attachBindings.mock.calls[0]?.[0],
    );
    expect(
      await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId: user.id, organizationId },
        },
        select: { pendingSsoGrantId: true },
      }),
    ).toEqual({ pendingSsoGrantId: null });
    expect(
      await prisma.grant.findFirst({
        where: {
          id: grantId,
          organizationId,
          principalType: "USER",
          principalId: user.id,
          roleKey: "member",
          revokedAt: null,
        },
        select: { id: true },
      }),
    ).toEqual({ id: grantId });
    expect(announceSignup).toHaveBeenCalledOnce();
    const fanouts = await prisma.processManagerOutbox.findMany({
      where: {
        processName: "joinRequestLifecycle",
        projectId: organizationId,
        intentType: "fanoutNotification",
      },
    });
    expect(fanouts).toHaveLength(1);
  });
});
