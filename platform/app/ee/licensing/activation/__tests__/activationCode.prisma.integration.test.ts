/**
 * @vitest-environment node
 *
 * Single-use redemption against a real Postgres.
 *
 * The unit test proves the service asks the store to decide. This proves the
 * store actually does, twice over. The first test holds one claim open in its
 * own transaction until the second is blocked on its row lock, which is the
 * interleaving that decides the question and does not depend on how fast the
 * machine is. The second sends five claims at once, which is the shape a real
 * burst takes.
 *
 * @see ../activationCode.prisma.ts
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
} from "../activationCode";
import { PrismaActivationCodes } from "../activationCode.prisma";

const RUN = `act-${Date.now()}`;
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

function codeOf(): { code: string; hash: string; hint: string } {
  const code = mintActivationCode();
  const normalised = normaliseActivationCode(code);
  if (!normalised) throw new Error("a minted code failed its own shape check");
  return {
    code,
    hash: activationCodeHash(normalised),
    hint: activationCodeHint(normalised),
  };
}

describe("activation codes on Postgres", () => {
  const repository = new PrismaActivationCodes(prisma);

  const issue = async (reusable: boolean) => {
    const { hash, hint } = codeOf();
    return repository.create({
      codeHash: hash,
      codeHint: hint,
      organizationId: `${RUN}-org`,
      organizationName: "ACME",
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 25,
      maxMembersLite: 0,
      licenseTermDays: 365,
      services: ["instant_evals"],
      expiresAt: NEXT_YEAR,
      reusable,
      createdById: "user-operator",
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.activationCode.deleteMany({
      where: { organizationId: `${RUN}-org` },
    });
  });

  describe("given a single-use code in the registry", () => {
    describe("when a second install claims it while the first still holds the row", () => {
      /** @scenario "The database decides which install wins, not the process" */
      it("refuses the second, because the write re-reads the row it waited for", async () => {
        const row = await issue(false);
        const at = new Date();
        const claimFor = (instance: string) => (tx: Prisma.TransactionClient) =>
          new PrismaActivationCodes(tx).claimSingleUse({
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

        expect(claims.first).toBe(true);
        expect(claims.second).toBe(false);

        const stored = await repository.findById(row.id);
        expect(stored?.redemptionCount).toBe(1);
        expect(stored?.redeemedByInstanceId).toBe(`${RUN}-first`);
      });
    });

    describe("when five installs redeem it at once", () => {
      /** @scenario "The database decides which install wins, not the process" */
      it("admits one claim and refuses the other four", async () => {
        const row = await issue(false);
        const at = new Date();

        const claims = await Promise.all(
          ["a", "b", "c", "d", "e"].map((suffix) =>
            repository.claimSingleUse({
              id: row.id,
              instanceId: `${RUN}-${suffix}`,
              at,
            }),
          ),
        );

        expect(claims.filter(Boolean)).toHaveLength(1);

        const stored = await repository.findById(row.id);
        expect(stored?.redemptionCount).toBe(1);
        expect(stored?.redeemedByInstanceId).toMatch(
          new RegExp(`^${RUN}-[abcde]$`),
        );
      });
    });
  });

  describe("given a claim whose license could not be signed", () => {
    describe("when it is released", () => {
      /** @scenario "A claim whose license could not be signed is released again" */
      it("puts the code back, and only for the install that held it", async () => {
        const row = await issue(false);
        const at = new Date();

        expect(
          await repository.claimSingleUse({
            id: row.id,
            instanceId: `${RUN}-holder`,
            at,
          }),
        ).toBe(true);

        // Another install trying to release a claim it never held changes
        // nothing, which is what keeps the release from being a way to steal a
        // code somebody else redeemed.
        await repository.releaseClaim({
          id: row.id,
          instanceId: `${RUN}-stranger`,
        });
        expect((await repository.findById(row.id))?.redeemedAt).not.toBeNull();

        await repository.releaseClaim({
          id: row.id,
          instanceId: `${RUN}-holder`,
        });
        const released = await repository.findById(row.id);
        expect(released?.redeemedAt).toBeNull();
        expect(released?.redemptionCount).toBe(0);

        expect(
          await repository.claimSingleUse({
            id: row.id,
            instanceId: `${RUN}-next`,
            at: new Date(),
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a reusable code", () => {
    describe("when three installs redeem it", () => {
      /** @scenario "A reusable code is redeemed by every install that presents it" */
      it("admits all three and counts them", async () => {
        const row = await issue(true);
        const at = new Date();

        for (const suffix of ["a", "b", "c"]) {
          expect(
            await repository.recordReusableRedemption({
              id: row.id,
              instanceId: `${RUN}-reuse-${suffix}`,
              at,
            }),
          ).toBe(true);
        }

        expect((await repository.findById(row.id))?.redemptionCount).toBe(3);
        // A single-use claim on a reusable code finds no row, and the reverse
        // holds too: the two writes never overlap.
        expect(
          await repository.claimSingleUse({
            id: row.id,
            instanceId: `${RUN}-reuse-d`,
            at,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a revoked code", () => {
    describe("when an install claims it", () => {
      it("is refused by the write itself", async () => {
        const row = await issue(false);
        await repository.revoke({
          id: row.id,
          at: new Date(),
          revokedById: "user-operator",
        });

        expect(
          await repository.claimSingleUse({
            id: row.id,
            instanceId: `${RUN}-late`,
            at: new Date(),
          }),
        ).toBe(false);
      });
    });
  });
});
