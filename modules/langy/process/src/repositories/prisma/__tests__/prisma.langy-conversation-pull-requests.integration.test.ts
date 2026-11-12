/**
 * @vitest-environment node
 * The conversation pull requests read model against a real Postgres: the fold's row round-trips,
 * and CI finds the conversation by pull request, repository matched without case.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangyConversationPullRequestsRepository } from "../prisma.langy-conversation-pull-requests.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = randomUUID().slice(0, 8);
const PROJECT_ID = `proj-pr-${RUN}`;
const OTHER_PROJECT_ID = `proj-pr-other-${RUN}`;
const CONVERSATION_ID = `conv-pr-${RUN}`;
/** A repository no other run shares, so runs on one database never see each other's rows. */
const REPOSITORY = `acme/agent-${RUN}`;

const stored = {
  state: {
    PullRequests: [{ repositoryFullName: REPOSITORY, prNumber: 12, linkedAt: 1_000 }],
    FollowUpsInARow: 2,
    CreatedAt: 1_000,
    UpdatedAt: 2_000,
    LastEventOccurredAt: 1_500,
  },
  cursor: { acceptedAt: 1_600, eventId: `evt-${RUN}` },
  occurredAt: 1_500,
  createdAt: 1_000,
  updatedAt: 2_000,
  version: "2026-11-13",
};

describe.skipIf(!databaseUrl)("given a conversation whose fold kept a pull request", () => {
  let connection: PrismaConnection;
  let repository: PrismaLangyConversationPullRequestsRepository;
  const at = { tenantId: createTenantId(PROJECT_ID), aggregateId: CONVERSATION_ID };

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:langy:pull-requests:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaLangyConversationPullRequestsRepository.create(connection.client);
    await repository.store(stored, at);
  });

  afterAll(async () => {
    await connection.client.langyConversationPullRequestsProjection.deleteMany({
      where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await connection.client.$disconnect();
  });

  it("reads back the row the fold stored", async () => {
    expect(await repository.get(CONVERSATION_ID, at)).toEqual({
      kind: "folded",
      projection: stored,
    });
  });

  it("stores over the same row when the fold moves on", async () => {
    await repository.store({ ...stored, state: { ...stored.state, FollowUpsInARow: 3 } }, at);
    const read = await repository.get(CONVERSATION_ID, at);
    await repository.store(stored, at);

    expect(read.kind === "folded" && read.projection.state.FollowUpsInARow).toBe(3);
  });

  /** @scenario "The read model finds the conversation that opened a pull request" */
  it("finds the conversation by pull request in its project, whatever the repository's case", async () => {
    const found = await repository.findByPullRequest({
      projectIds: [OTHER_PROJECT_ID, PROJECT_ID],
      repositoryFullName: REPOSITORY.toUpperCase(),
      prNumber: 12,
    });

    expect(found).toEqual([
      { projectId: PROJECT_ID, conversationId: CONVERSATION_ID, followUpsInARow: 2 },
    ]);
    expect(
      await repository.findByPullRequest({
        projectIds: [OTHER_PROJECT_ID],
        repositoryFullName: REPOSITORY,
        prNumber: 12,
      }),
    ).toEqual([]);
    expect(
      await repository.findByPullRequest({
        projectIds: [PROJECT_ID],
        repositoryFullName: REPOSITORY,
        prNumber: 13,
      }),
    ).toEqual([]);
  });
});
