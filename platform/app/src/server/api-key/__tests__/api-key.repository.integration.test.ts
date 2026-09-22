/**
 * @vitest-environment node
 *
 * The fenced revoke against a real Postgres, interleaved on one key.
 *
 * The repository's docblock promises the FIRST revocation's cause is the one
 * recorded. That is only true when the revoke that waited on the row lock
 * re-checks `revokedAt IS NULL` against the row as the first left it, which
 * is what this stages: a person's revoke is held open in its own transaction
 * until the cap's revoke is parked, and only then commits.
 *
 * @see ../api-key.repository.ts
 * @see specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import { ApiKeyRepository } from "../api-key.repository";
import type { ApiKeyRevocationCause } from "../revocation-cause";

const ns = `apikey-repo-${nanoid(8)}`;

let organizationId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "ACME", slug: `--${ns}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["apiKey", { organizationId }],
    ["organization", { id: organizationId }],
  ]);
});

async function liveKey() {
  return prisma.apiKey.create({
    data: {
      name: `key-${nanoid(6)}`,
      lookupId: `lookup-${nanoid(12)}`,
      hashedSecret: `hashed-${nanoid(12)}`,
      organizationId,
    },
  });
}

describe("api key revocation on Postgres", () => {
  describe("given a live key", () => {
    describe("when a person and the ingest-key cap revoke it at the same moment", () => {
      /** @scenario "The first revocation's cause is the one recorded" */
      it("records the person's cause, because the cap's write re-reads the row it waited for", async () => {
        const key = await liveKey();
        const revokeWith =
          (cause: ApiKeyRevocationCause) => (tx: Prisma.TransactionClient) =>
            ApiKeyRepository.create(tx).revoke({ id: key.id, cause });

        const answers = await raceOnOneRow({
          prisma,
          table: "ApiKey",
          first: revokeWith("user"),
          second: revokeWith("cap"),
        });

        // Both callers get the row that stands: dead either way, with the
        // first decision on it.
        expect(answers.first.revocationCause).toBe("user");
        expect(answers.second.revocationCause).toBe("user");
        const stored = await prisma.apiKey.findUniqueOrThrow({
          where: { id: key.id },
        });
        expect(stored.revocationCause).toBe("user");
        expect(stored.revokedAt).not.toBeNull();
      });
    });
  });
});
