import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  PrismaTenancyGuardService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import type { JoinRequestNotificationMail } from "../../../channels/join-request-notification-mail.channel.ts";
import { JoinRequestNotifierService } from "../../../features/join-request/services/join-request-notifier.service.ts";
import { PrismaJoinRequestAudienceRepository } from "../prisma.join-request-audience.repository.ts";
import { PrismaJoinRequestNotificationContextRepository } from "../prisma.join-request-notification-context.repository.ts";

/**
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 * The real Prisma client emits each query through the production tenancy guard, which answers
 * every statement it admits itself so nothing reaches a database.
 */

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: { model?: string; action: string; args: unknown }[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  constructor(private readonly answers: Record<string, unknown>) {
    super();
  }

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push({ model: context.model, action: context.action, args: context.args });

      return this.answers[`${context.model}.${context.action}`] ?? null;
    });
  }
}

function clientBehindTheGuard({ personalTeamSlugs }: { personalTeamSlugs: string[] }) {
  const guard = new TenancyGuardOnly({
    "Team.findMany": personalTeamSlugs.map((slug) => ({ slug })),
    "Organization.findUnique": { name: "Acme Corp" },
    "User.findUnique": { name: "Morgan Ellis", email: "morgan@acme.example" },
  });
  const connection = PrismaConnectionService.create({
    guard,
    logger: createTestLogger().logger,
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://guard-only@127.0.0.1:1/unreachable",
      log: ["error"],
    }),
  );

  return { guard, prisma: connection.client };
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
  const { guard, prisma } = clientBehindTheGuard({ personalTeamSlugs });
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

  return { guard, sendRequestExpired: recording.sendRequestExpired };
}

describe("PrismaJoinRequestNotificationContextRepository", () => {
  describe("given the organization tenancy guard is in force", () => {
    describe("when a requester who owns a personal project elsewhere lets a request lapse", () => {
      /** @scenario "An expired request tells the requester, with a link to their personal project when they have one" */
      it("mails them the link to that personal project", async () => {
        const { guard, sendRequestExpired } = await expire({
          personalTeamSlugs: ["personal-morgan-ellis"],
        });

        expect(guard.admitted).toContainEqual(
          expect.objectContaining({
            model: "Team",
            action: "findMany",
            args: expect.objectContaining({
              where: { ownerUserId: "user_morgan", isPersonal: true },
            }),
          }),
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

    describe("when a read of teams by owner is not of personal teams", () => {
      /** @scenario "An expired request tells the requester, with a link to their personal project when they have one" */
      it("is still refused before it is answered", async () => {
        const { guard, prisma } = clientBehindTheGuard({ personalTeamSlugs: [] });

        await expect(
          prisma.team.findMany({ where: { ownerUserId: "user_morgan" }, select: { slug: true } }),
        ).rejects.toThrow(/organizationId/);
        expect(guard.admitted).toEqual([]);
      });
    });
  });
});
