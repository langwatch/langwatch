/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 * A revoke parked on another revoke's row lock re-reads the dead row and records nothing.
 */
import { randomUUID } from "node:crypto";

import type { ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaApiKeyRepository } from "../prisma.api-key.repository.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("api key revocation on Postgres", () => {
  const ns = `apikey-repo-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:api-key:test:revoke-race"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  let organizationId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("given a live key", () => {
    describe("when a person and the ingest-key cap revoke it at the same moment", () => {
      /** @scenario "The first revocation's cause is the one recorded" */
      it("records the person's cause, because the cap's write re-reads the row it waited for", async () => {
        const key = await prisma.apiKey.create({
          data: {
            name: `key-${randomUUID().slice(0, 6)}`,
            lookupId: `lookup-${randomUUID()}`,
            hashedSecret: `hashed-${randomUUID()}`,
            organizationId,
          },
        });
        const revokeWith = (cause: ApiKeyRevocationCause) => (tx: Prisma.TransactionClient) =>
          PrismaApiKeyRepository.create({ prisma: tx }).revoke({ id: key.id, cause });

        const answers = await raceOnOneRow({
          prisma,
          table: "ApiKey",
          first: revokeWith("user"),
          second: revokeWith("cap"),
        });

        expect(answers.first.revocationCause).toBe("user");
        expect(answers.second.revocationCause).toBe("user");
        const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
        expect(stored.revocationCause).toBe("user");
        expect(stored.revokedAt).not.toBeNull();
      });
    });
  });
});
