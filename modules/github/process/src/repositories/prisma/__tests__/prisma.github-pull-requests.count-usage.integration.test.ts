/**
 * @vitest-environment node
 * Pull requests windowed on the day they were opened, against a real Postgres.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGithubPullRequestsRepository } from "../prisma.github-pull-requests.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `usage-${randomUUID()}`;
const ORGANIZATION_ID = `org-${RUN}`;
const OTHER_ORGANIZATION_ID = `org-other-${RUN}`;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

function pullRequest({
  number,
  prCreatedAt,
  organizationId = ORGANIZATION_ID,
}: {
  number: number;
  prCreatedAt: Date;
  organizationId?: string;
}) {
  return {
    organizationId,
    repositoryHost: "github.com",
    repositoryFullName: `acme/${RUN}`,
    headBranch: `branch-${number}`,
    prNumber: number,
    htmlUrl: `https://github.com/acme/${RUN}/pull/${number}`,
    title: `Pull request ${number}`,
    state: "open",
    prCreatedAt,
    // The install noticed every one of them today, which must not be what
    // the window is cut on.
    createdAt: NOW,
  };
}

describe.skipIf(!databaseUrl)("given pull requests opened over forty days", () => {
  let connection: PrismaConnection;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:usage-report:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    await connection.client.organization.createMany({
      data: [
        { id: ORGANIZATION_ID, name: `Usage ${RUN}`, slug: `usage-${RUN}` },
        { id: OTHER_ORGANIZATION_ID, name: `Usage other ${RUN}`, slug: `usage-other-${RUN}` },
      ],
    });
    await connection.client.githubPullRequest.createMany({
      data: [
        pullRequest({ number: 1, prCreatedAt: daysAgo(40) }),
        pullRequest({ number: 2, prCreatedAt: daysAgo(20) }),
        pullRequest({ number: 3, prCreatedAt: daysAgo(3) }),
        pullRequest({ number: 4, prCreatedAt: daysAgo(3), organizationId: OTHER_ORGANIZATION_ID }),
      ],
    });
  });

  afterAll(async () => {
    // Pull requests go with their organizations.
    await connection.client.organization.deleteMany({
      where: { id: { in: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID] } },
    });
    await connection.client.$disconnect();
  });

  describe("when the usage is counted", () => {
    /** @scenario "Pull requests are counted by the day they were opened" */
    it("windows pull requests on the day they were opened, not the day they were noticed", async () => {
      const repository = PrismaGithubPullRequestsRepository.create(connection.client);
      const count = (since?: number) =>
        repository.countUsage({
          organizationIds: [ORGANIZATION_ID],
          ...(since === undefined ? {} : { since }),
        });

      await expect(count()).resolves.toEqual({ pullRequests: 3 });
      await expect(count(NOW.getTime() - 7 * DAY)).resolves.toEqual({ pullRequests: 1 });
      await expect(count(NOW.getTime() - 28 * DAY)).resolves.toEqual({ pullRequests: 2 });
    });
  });
});
