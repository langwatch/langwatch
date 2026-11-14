import { PrismaTenancyGuardService } from "@langwatch/prisma-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import type { JoinRequestNotificationMail } from "../../../channels/join-request-notification-mail.channel.ts";
import { JoinRequestNotifierService } from "../../../features/join-request/services/join-request-notifier.service.ts";
import { PrismaJoinRequestAudienceRepository } from "../prisma.join-request-audience.repository.ts";
import { PrismaJoinRequestNotificationContextRepository } from "../prisma.join-request-notification-context.repository.ts";

/**
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 * Every scripted query runs through the production tenancy guard chain before it answers.
 */

const guard = PrismaTenancyGuardService.create();

function guarded<Answer>(model: string, action: string, answer: Answer) {
  return vi.fn(async (args: unknown) => guard.execute({ model, action, args }, async () => answer));
}

function guardedPrisma({ personalTeamSlugs }: { personalTeamSlugs: string[] }) {
  const teamFindMany = guarded(
    "Team",
    "findMany",
    personalTeamSlugs.map((slug) => ({ slug })),
  );
  const prisma = prismaDouble({
    team: { findMany: teamFindMany },
    organization: { findUnique: guarded("Organization", "findUnique", { name: "Acme Corp" }) },
    user: {
      findUnique: guarded("User", "findUnique", {
        name: "Morgan Ellis",
        email: "morgan@acme.example",
      }),
    },
  });
  return { prisma, teamFindMany };
}

function recordingMail() {
  const sendRequestExpired = vi.fn<JoinRequestNotificationMail["sendRequestExpired"]>(
    async () => undefined,
  );
  class RecordingMail implements JoinRequestNotificationMail {
    sendRequestExpired = sendRequestExpired;
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
    async sendJoinedAutomatically(): Promise<unknown> {
      return undefined;
    }
  }
  return { mail: new RecordingMail(), sendRequestExpired };
}

async function expire({ personalTeamSlugs }: { personalTeamSlugs: string[] }) {
  const { prisma, teamFindMany } = guardedPrisma({ personalTeamSlugs });
  const recording = recordingMail();
  const notifier = JoinRequestNotifierService.create({
    audience: PrismaJoinRequestAudienceRepository.create(prisma),
    context: PrismaJoinRequestNotificationContextRepository.create(prisma),
    mail: recording.mail,
    baseHost: "https://app.langwatch.ai",
  });

  await notifier.requestExpired({
    joinRequestId: "joinreq_1",
    organizationId: "organization_acme",
    requesterUserId: "user_morgan",
  });

  return { sendRequestExpired: recording.sendRequestExpired, teamFindMany };
}

describe("PrismaJoinRequestNotificationContextRepository", () => {
  describe("given the organization tenancy guard is in force", () => {
    describe("when a requester who owns a personal project elsewhere lets a request lapse", () => {
      /** @scenario "An expired request tells the requester, with a link to their personal project when they have one" */
      it("mails them the link to that personal project", async () => {
        const { sendRequestExpired, teamFindMany } = await expire({
          personalTeamSlugs: ["personal-morgan-ellis"],
        });

        expect(teamFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { ownerUserId: "user_morgan", isPersonal: true } }),
        );
        expect(sendRequestExpired).toHaveBeenCalledWith(
          expect.objectContaining({
            requesterEmail: "morgan@acme.example",
            organizationName: "Acme Corp",
            personalProjectUrl: "https://app.langwatch.ai/personal-morgan-ellis",
          }),
        );
      });
    });

    describe("when a requester with no personal project lets a request lapse", () => {
      /** @scenario "An expired request tells the requester, with a link to their personal project when they have one" */
      it("still mails them, with no link", async () => {
        const { sendRequestExpired } = await expire({ personalTeamSlugs: [] });

        expect(sendRequestExpired).toHaveBeenCalledTimes(1);
        expect(sendRequestExpired.mock.calls[0]?.[0].personalProjectUrl).toBeUndefined();
      });
    });

    describe("when teams are read by owner without naming personal teams", () => {
      /** @scenario "An expired request tells the requester, with a link to their personal project when they have one" */
      it("refuses the read", async () => {
        const read = guard.execute(
          { model: "Team", action: "findMany", args: { where: { ownerUserId: "user_morgan" } } },
          async () => [],
        );

        await expect(read).rejects.toThrow(/organizationId/);
      });
    });
  });
});
