/**
 * @vitest-environment node
 * @see specs/identity/domain-auto-join.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JoinRequestNotificationMail } from "../channels/join-request-notification-mail.channel.ts";
import { PrismaJoinRequestAudienceRepository } from "../repositories/prisma/prisma.join-request-audience.repository.ts";
import { JoinRequestNotifierService } from "../services/join-request-notifier.service.ts";

type SendJoinedAutomatically = JoinRequestNotificationMail["sendJoinedAutomatically"];

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("an automatic join announced to the joined organization", () => {
  const namespace = `join-notice-${nanoid(8)}`.toLowerCase();
  const domain = `${namespace}.test`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:join-request-admin-notice"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const emailOf = (name: string) => `${name}@${domain}`;

  async function seedPerson({
    name,
    organizationId,
    role,
    disabled = false,
  }: {
    name: string;
    organizationId?: string;
    role?: OrganizationUserRole;
    disabled?: boolean;
  }): Promise<string> {
    const user = await prisma.user.create({ data: { email: emailOf(name), name } });
    userIds.push(user.id);
    if (organizationId && role) {
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId,
          role,
          disabledAt: disabled ? new Date() : null,
        },
      });
    }
    return user.id;
  }

  let joinedId = "";
  let newcomerId = "";

  beforeAll(async () => {
    const joined = await prisma.organization.create({
      data: { name: "Joined Org", slug: `--test-${namespace}-joined` },
    });
    const other = await prisma.organization.create({
      data: { name: "Other Org", slug: `--test-${namespace}-other` },
    });
    joinedId = joined.id;
    organizationIds.push(joined.id, other.id);

    await seedPerson({ name: "live-one", organizationId: joined.id, role: "ADMIN" });
    await seedPerson({ name: "live-two", organizationId: joined.id, role: "ADMIN" });
    await seedPerson({
      name: "disabled-admin",
      organizationId: joined.id,
      role: "ADMIN",
      disabled: true,
    });
    await seedPerson({ name: "ordinary", organizationId: joined.id, role: "MEMBER" });
    await seedPerson({ name: "elsewhere-admin", organizationId: other.id, role: "ADMIN" });
    await seedPerson({ name: "elsewhere-member", organizationId: other.id, role: "MEMBER" });
    newcomerId = await seedPerson({ name: "newcomer" });
  });

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
    }
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  function notifierOver(sendJoinedAutomatically: SendJoinedAutomatically) {
    class RecordingMail implements JoinRequestNotificationMail {
      sendJoinedAutomatically = sendJoinedAutomatically;
      async sendRequestArrived(): Promise<unknown> {
        return undefined;
      }
      async sendRequestStillWaiting(): Promise<unknown> {
        return undefined;
      }
      async sendRequestApproved(): Promise<unknown> {
        return undefined;
      }
      async sendRequestRejected(): Promise<unknown> {
        return undefined;
      }
      async sendRequestExpired(): Promise<unknown> {
        return undefined;
      }
    }
    return JoinRequestNotifierService.create({
      audience: PrismaJoinRequestAudienceRepository.create(prisma),
      context: {
        getOrganizationIntent: async () => ({ primaryIntent: null }),
        countApprovedFromDomain: async () => 0,
        findPersonalTeamSlugs: async () => [],
      },
      mail: new RecordingMail(),
      baseHost: "https://app.langwatch.ai",
    });
  }

  describe("given live and disabled administrators, and people of another organization", () => {
    /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
    it("emails only the joined organization's live administrators, naming organization, member and domain", async () => {
      const send = vi.fn<SendJoinedAutomatically>(async () => undefined);

      await notifierOver(send).joinedAutomatically({
        joinRequestId: "joinreq_notice",
        organizationId: joinedId,
        requesterUserId: newcomerId,
        domain,
      });

      const sent = send.mock.calls.map(([notice]) => notice);
      expect(sent.map((notice) => notice.adminEmail).toSorted()).toEqual([
        emailOf("live-one"),
        emailOf("live-two"),
      ]);
      for (const notice of sent) {
        expect(notice).toMatchObject({
          organizationName: "Joined Org",
          memberName: "newcomer",
          domain,
        });
      }
    });

    /** @scenario "Automatic-join notices reach only live administrators in the joined organization" */
    it("lets one failed delivery leave the other administrators' notices sent", async () => {
      const delivered: string[] = [];
      const send = vi.fn<SendJoinedAutomatically>(async ({ adminEmail }) => {
        if (adminEmail === emailOf("live-one")) throw new Error("mailbox unavailable");
        delivered.push(adminEmail);
        return undefined;
      });

      await expect(
        notifierOver(send).joinedAutomatically({
          joinRequestId: "joinreq_notice_failure",
          organizationId: joinedId,
          requesterUserId: newcomerId,
          domain,
        }),
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(2);
      expect(delivered).toEqual([emailOf("live-two")]);
    });
  });
});
