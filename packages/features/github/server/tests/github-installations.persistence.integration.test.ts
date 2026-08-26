import { nanoid } from "nanoid";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaGithubInstallationsRepository } from "../src/repositories/prisma/github-installations.repository";
import type { UpsertGithubInstallationInput } from "../src/repositories/github-installations.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for this integration suite");
  }

  return connection.client;
}

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

function repository(): PrismaGithubInstallationsRepository {
  return PrismaGithubInstallationsRepository.create(database());
}

function input(
  installationId: string,
  organizationId: string,
): UpsertGithubInstallationInput {
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

// The tenancy guard on GithubInstallation only recognises an exact-string
// `installationId` (or `organizationId`) in a WHERE clause, not a `startsWith`/
// `in` filter — see dbOrganizationIdProtection.ts's `extraBound` check — so
// cleanup deletes each known id by exact match rather than by prefix.
const installationIds = [
  `${namespace}-fresh`,
  `${namespace}-race`,
  `${namespace}-existing`,
  `${namespace}-first`,
  `${namespace}-second`,
];

afterEach(async () => {
  for (const installationId of installationIds) {
    await database().githubInstallation.deleteMany({
      where: { installationId },
    });
  }
});

afterAll(async () => {
  await connection?.closeOnce();
});

describe.skipIf(!databaseUrl)(
  "PrismaGithubInstallationsRepository.insertOrGetExisting",
  () => {
    describe("when the installation id is fresh", () => {
      it("inserts and reports wasInserted: true", async () => {
        const installationId = `${namespace}-fresh`;
        const orgId = `${namespace}-org-a`;

        const result = await repository().insertOrGetExisting(
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
          repository().insertOrGetExisting(input(installationId, orgA)),
          repository().insertOrGetExisting(input(installationId, orgB)),
        ]);

        const inserted = [resultA, resultB].filter((r) => r.wasInserted);
        const conflicted = [resultA, resultB].filter((r) => !r.wasInserted);
        expect(inserted).toHaveLength(1);
        expect(conflicted).toHaveLength(1);
        // The loser's "existing" read is the winner's committed row — never a
        // stale/absent value — proving the unique index, not call ordering,
        // resolved the race.
        expect(conflicted[0]!.row.organizationId).toBe(inserted[0]!.row.organizationId);

        const stored = await database().githubInstallation.findUnique({
          where: { installationId },
        });
        expect(stored?.organizationId).toBe(inserted[0]!.row.organizationId);
      });
    });

    describe("when one organization connects a second GitHub account", () => {
      /** @scenario "A single installation id is unique but an org may have many" */
      it("keeps both installations, each id appearing once", async () => {
        const orgId = `${namespace}-org-a`;

        await repository().insertOrGetExisting(input(`${namespace}-first`, orgId));
        await repository().insertOrGetExisting(input(`${namespace}-second`, orgId));

        const stored = await repository().findAllForOrganization(orgId);
        const ids = stored.map((r) => r.installationId);
        expect(ids).toEqual([`${namespace}-first`, `${namespace}-second`]);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });

    describe("when the installation id already exists", () => {
      /** @scenario "A single installation id is unique but an org may have many" */
      it("reports wasInserted: false with the existing row, and never overwrites it", async () => {
        const installationId = `${namespace}-existing`;
        const orgA = `${namespace}-org-a`;
        const orgB = `${namespace}-org-b`;
        await repository().insertOrGetExisting(input(installationId, orgA));

        const result = await repository().insertOrGetExisting(
          input(installationId, orgB),
        );

        expect(result.wasInserted).toBe(false);
        expect(result.row.organizationId).toBe(orgA);
        const stored = await database().githubInstallation.findUnique({
          where: { installationId },
        });
        expect(stored?.organizationId).toBe(orgA);
      });
    });
  },
);
