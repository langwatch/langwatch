import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { PrismaLangyGithubInstallationsRepository } from "../langy-github-installations.prisma.repository";
import type { UpsertLangyGithubInstallationInput } from "../langy-github-installations.repository";

/**
 * `insertOrGetExisting`'s whole point is that a real Postgres unique-index
 * violation — not application-level timing — resolves the race between two
 * organizations claiming the same installation id. The service/route unit
 * tests mock this repository, so they can only prove the SERVICE correctly
 * interprets whatever the repo returns; they can't prove Postgres actually
 * serializes the concurrent writes the way the fix assumes. This exercises
 * the real Prisma path against the real test database.
 */
const namespace = `langy-install-${nanoid(10)}`;
const repository = new PrismaLangyGithubInstallationsRepository(prisma);

function input(
  installationId: string,
  organizationId: string,
): UpsertLangyGithubInstallationInput {
  return {
    installationId,
    organizationId,
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "9000",
    repositorySelection: "all",
    repositories: null,
  };
}

// The tenancy guard on LangyGithubInstallation only recognises an exact-string
// `installationId` (or `organizationId`) in a WHERE clause, not a `startsWith`/
// `in` filter — see dbOrganizationIdProtection.ts's `extraBound` check — so
// cleanup deletes each known id by exact match rather than by prefix.
const installationIds = [
  `${namespace}-fresh`,
  `${namespace}-race`,
  `${namespace}-existing`,
];

afterEach(async () => {
  for (const installationId of installationIds) {
    await prisma.langyGithubInstallation.deleteMany({
      where: { installationId },
    });
  }
});

describe("PrismaLangyGithubInstallationsRepository.insertOrGetExisting", () => {
  describe("when the installation id is fresh", () => {
    it("inserts and reports wasInserted: true", async () => {
      const installationId = `${namespace}-fresh`;
      const orgId = `${namespace}-org-a`;

      const result = await repository.insertOrGetExisting(
        input(installationId, orgId),
      );

      expect(result.wasInserted).toBe(true);
      expect(result.row.organizationId).toBe(orgId);
    });
  });

  describe("when two organizations race for the same fresh installation id", () => {
    it("lets Postgres's unique constraint pick exactly one winner", async () => {
      const installationId = `${namespace}-race`;
      const orgA = `${namespace}-org-a`;
      const orgB = `${namespace}-org-b`;

      const [resultA, resultB] = await Promise.all([
        repository.insertOrGetExisting(input(installationId, orgA)),
        repository.insertOrGetExisting(input(installationId, orgB)),
      ]);

      const inserted = [resultA, resultB].filter((r) => r.wasInserted);
      const conflicted = [resultA, resultB].filter((r) => !r.wasInserted);
      expect(inserted).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      // The loser's "existing" read is the winner's committed row — never a
      // stale/absent value — proving the unique index, not call ordering,
      // resolved the race.
      expect(conflicted[0]!.row.organizationId).toBe(
        inserted[0]!.row.organizationId,
      );

      const stored = await prisma.langyGithubInstallation.findUnique({
        where: { installationId },
      });
      expect(stored?.organizationId).toBe(inserted[0]!.row.organizationId);
    });
  });

  describe("when the installation id already exists", () => {
    it("reports wasInserted: false with the existing row, and never overwrites it", async () => {
      const installationId = `${namespace}-existing`;
      const orgA = `${namespace}-org-a`;
      const orgB = `${namespace}-org-b`;
      await repository.insertOrGetExisting(input(installationId, orgA));

      const result = await repository.insertOrGetExisting(
        input(installationId, orgB),
      );

      expect(result.wasInserted).toBe(false);
      expect(result.row.organizationId).toBe(orgA);
      const stored = await prisma.langyGithubInstallation.findUnique({
        where: { installationId },
      });
      expect(stored?.organizationId).toBe(orgA);
    });
  });
});
