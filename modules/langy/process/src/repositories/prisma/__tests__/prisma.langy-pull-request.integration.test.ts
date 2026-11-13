/**
 * @vitest-environment node
 * The pull request rows against a real Postgres: one row per pull request owned by the
 * conversation's owner, CI's lookup by repository and number, and the daily cap's count.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { initLangyConversationState } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangyConversationProjectionRepository } from "../prisma.langy-conversation-projection.repository.ts";
import { PrismaLangyPullRequestRepository } from "../prisma.langy-pull-request.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = randomUUID().slice(0, 8);
const PROJECT_ID = `proj-pr-${RUN}`;
const OTHER_PROJECT_ID = `proj-pr-other-${RUN}`;
const CONVERSATION_ID = `conv-pr-${RUN}`;
const OTHER_CONVERSATION_ID = `conv-pr-other-${RUN}`;
const USER_ID = `user-pr-${RUN}`;
/** A repository no other run shares, so runs on one database never see each other's rows. */
const REPOSITORY = `acme/agent-${RUN}`;
const OPENED_AT = 1_000_000;

describe.skipIf(!databaseUrl)("given the pull requests Langy opened for a person", () => {
  let connection: PrismaConnection;
  let pullRequests: PrismaLangyPullRequestRepository;

  const at = (projectId: string, conversationId: string) => ({
    tenantId: createTenantId(projectId),
    aggregateId: conversationId,
  });

  const openedIn = (projectId: string, conversationId: string, prNumbers: number[], when = 0) =>
    pullRequests.append(
      {
        ConversationId: conversationId,
        PullRequests: prNumbers.map((prNumber) => ({ repositoryFullName: REPOSITORY, prNumber })),
        OpenedAt: OPENED_AT + when,
        SourceEventId: `evt-${conversationId}-${when}`,
      },
      at(projectId, conversationId),
    );

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:langy:pull-requests:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    pullRequests = PrismaLangyPullRequestRepository.create(connection.client);
    const conversations = PrismaLangyConversationProjectionRepository.create(connection.client);
    for (const [projectId, conversationId] of [
      [PROJECT_ID, CONVERSATION_ID],
      [OTHER_PROJECT_ID, OTHER_CONVERSATION_ID],
    ] as const) {
      await conversations.store(
        {
          state: {
            ...initLangyConversationState(),
            ConversationId: conversationId,
            UserId: USER_ID,
            CreatedAt: 1,
            UpdatedAt: 1,
            LastEventOccurredAt: 1,
          },
          cursor: { acceptedAt: 1, eventId: `evt-start-${conversationId}` },
          occurredAt: 1,
          createdAt: 1,
          updatedAt: 1,
          version: "test",
        },
        at(projectId, conversationId),
      );
    }
    await openedIn(PROJECT_ID, CONVERSATION_ID, [12, 13]);
    await openedIn(PROJECT_ID, CONVERSATION_ID, [12], 50);
    await openedIn(OTHER_PROJECT_ID, OTHER_CONVERSATION_ID, [14], 100);
  });

  afterAll(async () => {
    await connection.client.langyPullRequest.deleteMany({
      where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await connection.client.langyConversationProjection.deleteMany({
      where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await connection.client.$disconnect();
  });

  /** @scenario "The read model finds the conversation that opened a pull request" */
  it("finds the conversation by pull request in its project, whatever the repository's case", async () => {
    expect(
      await pullRequests.findByPullRequest({
        projectIds: [OTHER_PROJECT_ID, PROJECT_ID],
        repositoryFullName: REPOSITORY.toUpperCase(),
        prNumber: 12,
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        openedAt: OPENED_AT,
      },
    ]);
    expect(
      await pullRequests.findByPullRequest({
        projectIds: [OTHER_PROJECT_ID],
        repositoryFullName: REPOSITORY,
        prNumber: 12,
      }),
    ).toEqual([]);
    expect(
      await pullRequests.findByPullRequest({
        projectIds: [PROJECT_ID],
        repositoryFullName: REPOSITORY,
        prNumber: 99,
      }),
    ).toEqual([]);
  });

  /** @scenario "The daily cap counts a person's pull requests in every project" */
  it("counts each pull request once, in every project, from the instant asked", async () => {
    expect(await pullRequests.countOpenedSince({ userId: USER_ID, since: OPENED_AT })).toBe(3);
    expect(await pullRequests.countOpenedSince({ userId: USER_ID, since: OPENED_AT + 1 })).toBe(1);
    expect(await pullRequests.countOpenedSince({ userId: `${USER_ID}-x`, since: 0 })).toBe(0);
  });

  it("retries an answer whose conversation is not folded yet", async () => {
    const failure = await openedIn(PROJECT_ID, `conv-missing-${RUN}`, [20]).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ retryable: true });
  });
});
