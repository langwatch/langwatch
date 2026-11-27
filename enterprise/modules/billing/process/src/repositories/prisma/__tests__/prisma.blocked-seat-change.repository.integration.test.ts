// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Refused seat changes on a real Postgres, kept until their admin is told.
 * @see ../../../../../../../specs/licensing/proration-preview.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaBlockedSeatChangeRepository } from "../prisma.blocked-seat-change.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("refused seat changes on Postgres", () => {
  const organizationId = `blocked_seat_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:blocked-seat-change"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const changes = PrismaBlockedSeatChangeRepository.create(prisma);

  const otherOrganizationId = `${organizationId}_other`;

  afterAll(async () => {
    await prisma.blockedSeatChange.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.$disconnect();
  });

  /** @scenario "Refused seat changes are kept on Postgres until the admin is told" */
  it("lists a refused change as waiting until it is marked told, and never after", async () => {
    await changes.record({
      organizationId,
      userId: "user_admin",
      attempt: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
      seats: 1,
    });

    const mine = async () =>
      (await changes.findWaiting()).filter((each) => each.organizationId === organizationId);
    expect(await mine()).toEqual([
      expect.objectContaining({
        userId: "user_admin",
        attempt: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
        seats: 1,
      }),
    ]);

    await changes.record({
      organizationId: otherOrganizationId,
      userId: "user_admin",
      attempt: { kind: "seat_purchase", seats: 2 },
      seats: 2,
    });
    await changes.record({
      organizationId,
      userId: "user_other_admin",
      attempt: { kind: "seat_purchase", seats: 2 },
      seats: 2,
    });
    expect(
      (await changes.findWaitingFor({ organizationId, userId: "user_admin" })).map(
        (each) => each.attempt,
      ),
    ).toEqual([{ kind: "role_change", memberName: "Jane Doe", role: "Admin" }]);
    await changes.markNotified({
      organizationId,
      userId: "user_other_admin",
      createdUpTo: nowInstant(),
      at: nowInstant(),
    });

    const [told] = await mine();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await changes.record({
      organizationId,
      userId: "user_admin",
      attempt: { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
      seats: 1,
    });
    await changes.markNotified({
      organizationId,
      userId: "user_admin",
      createdUpTo: told!.createdAt,
      at: nowInstant(),
    });
    expect((await mine()).map((each) => each.attempt)).toEqual([
      { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
    ]);

    await changes.markNotified({
      organizationId,
      userId: "user_admin",
      createdUpTo: nowInstant(),
      at: nowInstant(),
    });
    expect(await mine()).toEqual([]);
  });
});
