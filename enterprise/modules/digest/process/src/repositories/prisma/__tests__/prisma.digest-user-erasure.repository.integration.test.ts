// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Clear digest rows on user erasure, in Postgres: the person's subscription, sends and folded
 * weeks go in every organization, through the tenancy guard; another person's rows stay.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type PrismaConnection,
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emptyUserWeek } from "../../../rules/digest-week.rules.ts";
import { DigestUserErasureService } from "../../../services/digest-user-erasure.service.ts";
import { PrismaDigestAudienceRepository } from "../prisma.digest-audience.repository.ts";
import { PrismaDigestSendRepository } from "../prisma.digest-send.repository.ts";
import { PrismaDigestUserWeekRepository } from "../prisma.digest-user-week.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
// A send row is one per person and week, so each organization's send is of its own week.
const organizations = [
  { organizationId: `test-digest-erasure-a-${run}`, sendWeek: "2026-W45" },
  { organizationId: `test-digest-erasure-b-${run}`, sendWeek: "2026-W46" },
];
const organizationIds = organizations.map(({ organizationId }) => organizationId);
const erased = `test-digest-erasure-erased-${run}`;
const kept = `test-digest-erasure-kept-${run}`;
const ISO_WEEK = "2026-W46";
const AT = Date.parse("2026-11-11T12:00:00Z");

describe.skipIf(!databaseUrl)("given digest rows naming two people in two organizations", () => {
  let connection: PrismaConnection;
  let audience: PrismaDigestAudienceRepository;
  let sends: PrismaDigestSendRepository;
  let userWeeks: PrismaDigestUserWeekRepository;
  let erasure: DigestUserErasureService;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:digest:test:user-erasure"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    audience = PrismaDigestAudienceRepository.create({ prisma: connection.client });
    sends = PrismaDigestSendRepository.create({ prisma: connection.client });
    userWeeks = PrismaDigestUserWeekRepository.create({ prisma: connection.client });
    erasure = DigestUserErasureService.create({ audience, sends, userWeeks });

    for (const userId of [erased, kept]) {
      await audience.unsubscribe({ userId, sendId: `${userId}:${ISO_WEEK}`, at: AT });
      for (const { organizationId, sendWeek } of organizations) {
        await sends.claim({
          userId,
          organizationId,
          isoWeek: sendWeek,
          templateId: "digest-week",
          sentAt: AT,
        });
        const key = `${organizationId}:${userId}:${ISO_WEEK}`;
        await userWeeks.store(
          {
            state: { ...emptyUserWeek(), userId, organizationId, isoWeek: ISO_WEEK },
            cursor: { eventId: `event-${key}`, acceptedAt: AT },
            occurredAt: AT,
            createdAt: AT,
            updatedAt: AT,
            version: "test",
          },
          { aggregateId: key, key, tenantId: createTenantId(organizationId) },
        );
      }
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.digestSend.deleteMany({ where: { organizationId } });
      await connection.client.digestUserWeek.deleteMany({ where: { organizationId } });
    }
    for (const userId of [erased, kept]) {
      await connection.client.digestSubscription.deleteMany({ where: { userId } });
    }
    await connection.closeOnce();
  });

  const weekOwnersIn = async (organizationId: string) =>
    (
      await Promise.all(
        [erased, kept].map((userId) =>
          userWeeks.findWeeks({ isoWeeks: [ISO_WEEK], organizationId, userId }),
        ),
      )
    )
      .flat()
      .map(({ userId }) => userId);
  const sendersIn = async (organizationId: string) =>
    (
      await connection.client.digestSend.findMany({
        where: { organizationId },
        select: { userId: true },
      })
    ).map(({ userId }) => userId);

  describe("when one person's rows are cleared, twice", () => {
    /** @scenario "Digest rows naming an erased person are cleared" */
    it("deletes their subscription, sends and weeks in both organizations and keeps the other person's", async () => {
      for (let delivery = 0; delivery < 2; delivery++) {
        await erasure.forgetUser({ userId: erased });
      }

      await expect(audience.findUnsubscribed({ userIds: [erased, kept] })).resolves.toEqual([kept]);
      for (const organizationId of organizationIds) {
        await expect(sendersIn(organizationId)).resolves.toEqual([kept]);
        await expect(weekOwnersIn(organizationId)).resolves.toEqual([kept]);
      }
    });
  });

  describe("when rows are cleared for a person no digest row names", () => {
    /** @scenario "Clearing digest rows for a person digest holds nothing for changes nothing" */
    it("leaves the other person's rows as they were", async () => {
      await erasure.forgetUser({ userId: `test-digest-erasure-nobody-${run}` });

      await expect(audience.findUnsubscribed({ userIds: [kept] })).resolves.toEqual([kept]);
      for (const organizationId of organizationIds) {
        await expect(sendersIn(organizationId)).resolves.toEqual([kept]);
        await expect(weekOwnersIn(organizationId)).resolves.toEqual([kept]);
      }
    });
  });
});
