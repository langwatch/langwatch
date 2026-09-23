/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/activation-codes.feature
 *
 * Single-use redemption against a real Postgres: the store decides, not the process.
 */
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
} from "../../../rules/activation-code.rules.ts";
import { PrismaActivationCodeRepository } from "../prisma.activation-code.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const RUN = `act-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("activation codes on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaActivationCodeRepository.create(prisma);

  async function issue(reusable: boolean) {
    const normalised = normaliseActivationCode(mintActivationCode());
    if (!normalised) throw new Error("a minted code failed its own shape check");
    return repository.create({
      codeHash: activationCodeHash(normalised),
      codeHint: activationCodeHint(normalised),
      organizationId: `${RUN}-org`,
      organizationName: "ACME",
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 25,
      maxMembersLite: 0,
      licenseTermDays: 365,
      services: ["instant_evals"],
      expiresAt: nowInstant().add({ hours: 24 * 365 }),
      reusable,
      createdById: "user-operator",
    });
  }

  afterAll(async () => {
    await prisma.activationCode.deleteMany({ where: { organizationId: `${RUN}-org` } });
    await prisma.$disconnect();
  });

  describe("given a single-use code", () => {
    /** @scenario "The database decides which install wins, not the process" */
    it("refuses a second claim parked on the first one's row lock", async () => {
      const row = await issue(false);
      const at = nowInstant();
      const claimFor = (instance: string) => (tx: Prisma.TransactionClient) =>
        PrismaActivationCodeRepository.create(tx).claimSingleUse({
          id: row.id,
          instanceId: `${RUN}-${instance}`,
          at,
        });

      const claims = await raceOnOneRow({
        prisma,
        table: "ActivationCode",
        first: claimFor("first"),
        second: claimFor("second"),
      });

      expect(claims).toEqual({ first: true, second: false });
      const stored = await repository.findById(row.id);
      expect(stored?.redemptionCount).toBe(1);
      expect(stored?.redeemedByInstanceId).toBe(`${RUN}-first`);
    });

    /** @scenario "The database decides which install wins, not the process" */
    it("admits one of five claims sent at once", async () => {
      const row = await issue(false);
      const at = nowInstant();

      const claims = await Promise.all(
        ["a", "b", "c", "d", "e"].map((suffix) =>
          repository.claimSingleUse({ id: row.id, instanceId: `${RUN}-${suffix}`, at }),
        ),
      );

      expect(claims.filter(Boolean)).toHaveLength(1);
      const stored = await repository.findById(row.id);
      expect(stored?.redemptionCount).toBe(1);
      expect(stored?.redeemedByInstanceId).toMatch(new RegExp(`^${RUN}-[abcde]$`));
    });
  });

  describe("given a claim whose license could not be signed", () => {
    it("puts the code back, and only for the install that held it", async () => {
      const row = await issue(false);
      await expect(
        repository.claimSingleUse({ id: row.id, instanceId: `${RUN}-holder`, at: nowInstant() }),
      ).resolves.toBe(true);

      await repository.releaseClaim({ id: row.id, instanceId: `${RUN}-stranger` });
      expect((await repository.findById(row.id))?.redeemedAt).not.toBeNull();

      await repository.releaseClaim({ id: row.id, instanceId: `${RUN}-holder` });
      const released = await repository.findById(row.id);
      expect(released?.redeemedAt).toBeNull();
      expect(released?.redemptionCount).toBe(0);

      await expect(
        repository.claimSingleUse({ id: row.id, instanceId: `${RUN}-next`, at: nowInstant() }),
      ).resolves.toBe(true);
    });
  });

  describe("given a reusable code", () => {
    it("admits three installs, counts them, and never takes a single-use claim", async () => {
      const row = await issue(true);
      const at = nowInstant();

      for (const suffix of ["a", "b", "c"]) {
        await expect(
          repository.recordReusableRedemption({
            id: row.id,
            instanceId: `${RUN}-reuse-${suffix}`,
            at,
          }),
        ).resolves.toBe(true);
      }

      expect((await repository.findById(row.id))?.redemptionCount).toBe(3);
      await expect(
        repository.claimSingleUse({ id: row.id, instanceId: `${RUN}-reuse-d`, at }),
      ).resolves.toBe(false);
    });
  });

  describe("given a revoked code", () => {
    it("is refused by the write itself", async () => {
      const row = await issue(false);
      await repository.revoke({ id: row.id, at: nowInstant(), revokedById: "user-operator" });

      await expect(
        repository.claimSingleUse({
          id: row.id,
          instanceId: `${RUN}-late`,
          at: nowInstant(),
        }),
      ).resolves.toBe(false);
    });
  });
});
