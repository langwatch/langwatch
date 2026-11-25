/**
 * better-auth's two-step challenge writes the person's id as the value of every challenge, so
 * two challenges for one person must both be stored (WEB-19201).
 * @see modules/auth/specs/two-step-set-up.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaSignUpVerificationTokenRepository } from "../prisma.signup-verification-token.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-auth-verification-${randomUUID()}`;
const userId = `${namespace}-sam`;
const expires = new Date("2030-01-01T00:00:00.000Z");

describe.skipIf(!databaseUrl)("VerificationToken values", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:verification-values"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.verificationToken.deleteMany({
      where: { identifier: { startsWith: namespace } },
    });
    await connection.closeOnce();
  });

  describe("given a two-step challenge the person left unfinished", () => {
    /** @scenario "An unfinished two-step challenge does not stop the next sign-in" */
    it("stores the next challenge and its attempt counter beside it", async () => {
      const prisma = connection.client;
      for (const challenge of ["first", "second"]) {
        await prisma.verificationToken.create({
          data: { identifier: `${namespace}-2fa-${challenge}`, token: userId, expires },
        });
        await prisma.verificationToken.create({
          data: { identifier: `${namespace}-2fa-attempts-${challenge}`, token: "0", expires },
        });
      }

      const stored = await prisma.verificationToken.count({
        where: { identifier: { startsWith: namespace } },
      });

      expect(stored).toBe(4);
    });
  });

  describe("given a sign-up confirmation token beside them", () => {
    /** @scenario "An unfinished two-step challenge does not stop the next sign-in" */
    it("still claims the confirmation by its token", async () => {
      const repository = PrismaSignUpVerificationTokenRepository.create({
        prisma: connection.client,
      });
      const token = `${namespace}-confirm`;
      await repository.issue({
        identifier: `${namespace}-identity-signup:sam@example.com`,
        token,
        expires: Temporal.Instant.from(expires.toISOString()),
      });

      const claim = await repository.claim({
        token,
        now: Temporal.Now.instant(),
        keepSpentUntil: Temporal.Instant.from(expires.toISOString()),
      });

      expect(claim).toMatchObject({ claimed: true });
    });
  });
});
