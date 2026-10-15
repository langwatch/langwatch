/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 *
 * Testing-licence tokens against a real Postgres: found by hash only, revoked once, use stamped.
 */
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import {
  mintTestingLicenseToken,
  TESTING_LICENSE_TOKEN_KSUID_RESOURCE,
  testingLicenseTokenHash,
} from "../../../rules/testing-license-token.rules.ts";
import { PrismaTestingLicenseTokenRepository } from "../prisma.testing-license-token.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";

const OWNER = `owner-${generate("testrun").toString()}`;

describe.skipIf(!TEST_DATABASE_URL)("testing-licence tokens on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaTestingLicenseTokenRepository.create(prisma);

  async function create() {
    const token = mintTestingLicenseToken();
    const row = await repository.create({
      id: generate(TESTING_LICENSE_TOKEN_KSUID_RESOURCE).toString(),
      tokenHash: testingLicenseTokenHash(token),
      kind: "service",
      ownerUserId: OWNER,
      name: "GitHub Actions",
      expiresAt: nowInstant().add({ hours: 24 * 90 }),
    });
    return { token, row };
  }

  afterAll(async () => {
    await prisma.testingLicenseToken.deleteMany({ where: { ownerUserId: OWNER } });
    await prisma.$disconnect();
  });

  describe("given a service token an ops manager created", () => {
    /** @scenario "A revoked or expired service token issues nothing" */
    it("is found by its token's hash, and revoked exactly once", async () => {
      const { token, row } = await create();

      const [found] = await repository.findByTokenHash(testingLicenseTokenHash(token));
      const first = await repository.revoke({ id: row.id, at: nowInstant(), revokedById: "ops-1" });
      const second = await repository.revoke({
        id: row.id,
        at: nowInstant(),
        revokedById: "ops-2",
      });
      const [revoked] = await repository.findById(row.id);

      expect(found).toMatchObject({ id: row.id, kind: "service", name: "GitHub Actions" });
      expect(found).not.toHaveProperty("tokenHash");
      expect([first, second]).toEqual([true, false]);
      expect(revoked?.revokedById).toBe("ops-1");
    });
  });

  describe("given a token that issued a testing licence", () => {
    /** @scenario "Ops managers see every service token and when it was last used" */
    it("records when it was last used", async () => {
      const { row } = await create();
      const at = nowInstant();

      await repository.recordUse({ id: row.id, at });
      const [used] = await repository.findById(row.id);

      expect(used?.lastUsedAt?.epochMilliseconds).toBe(at.epochMilliseconds);
    });
  });
});
